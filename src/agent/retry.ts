import { MiniMaxApiError } from '../api/errors';
import type {
  AnthropicContentBlock,
  AnthropicMessage,
  StopReason,
  StreamEvent,
  Usage
} from '../api/types';
import type { AgentOptions } from './types';
import { isAvailabilityError } from './fallback';

// Where the requests of a turn go. The turn that moved to the fallback model
// stays there: the chat model would fail every next request the same way.
export interface ModelRoute {
  onFallback: boolean;
}

// How many times a request is repeated when the connection is lost.
export const DEFAULT_MAX_RETRIES = 5;
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_DELAY_MS = 30_000;

// The delay grows with every attempt: a second, two, four, eight. The
// server needs time, a fast second attempt hits the same overload.
export function retryDelay(attempt: number, baseMs = RETRY_BASE_DELAY_MS): number {
  return Math.min(baseMs * 2 ** Math.max(0, attempt), RETRY_MAX_DELAY_MS);
}

// The pause between the attempts ends at once when the user stops the
// turn, the panel must not wait for the delay.
async function waitBeforeRetry(controller: AbortController, ms: number): Promise<void> {
  if (controller.signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      controller.signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
}

// The request of the model with the repeats. A lost connection repeats the
// request, a broken answer repeats it from the start.
export async function streamWithRetry(
  options: AgentOptions,
  controller: AbortController,
  messages: AnthropicMessage[],
  handleEvent: (event: StreamEvent) => void,
  route: ModelRoute = { onFallback: false }
): Promise<{
  blocks: AnthropicContentBlock[];
  stopReason: StopReason;
  usage: Usage;
}> {
  const maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
  const baseDelay = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  let attempt = 0;
  for (;;) {
    let emitted = false;
    let blocks: AnthropicContentBlock[] = [];
    let stopReason: StopReason = 'end_turn';
    let usage: Usage = { inputTokens: 0, outputTokens: 0 };
    // The budget of the goal ran out in the middle of the answer.
    let budgetStopped = false;
    const fallback = route.onFallback ? options.fallback : undefined;
    try {
      const stream = options.client.stream(
        {
          model: fallback?.model ?? options.model,
          maxTokens: fallback?.maxTokens ?? options.maxTokens,
          system: options.systemPrompt,
          messages: [...messages],
          tools: options.registry.toAnthropicTools(options.mode),
          effort: fallback ? fallback.effort : options.effort,
          thinking: fallback ? fallback.thinking : options.thinking,
          signal: controller.signal
        },
        { signal: controller.signal }
      );
      for await (const event of stream) {
        // The budget of the goal is checked before every event of the
        // stream: a long answer stops in the middle of the turn when
        // the time of the goal is over. Only the limit of the time can
        // trip here, the spend of the request is counted after it.
        if (options.budget && !options.budget()) {
          budgetStopped = true;
          break;
        }
        handleEvent(event);
        if (event.type === 'text_delta' || event.type === 'thinking_delta') {
          emitted = true;
        }
        if (event.type === 'message_stop') {
          blocks = event.blocks;
          stopReason = event.stopReason;
          usage = event.usage;
        }
      }
      if (budgetStopped) {
        // The answer was cut. The text that came stays visible in the
        // panel, the tools of the request do not run and the history
        // keeps no call without a result.
        blocks = [];
        stopReason = 'goal_limit';
      }
      return { blocks, stopReason, usage };
    } catch (error) {
      const retryable = error instanceof MiniMaxApiError && error.retryable;
      // A request that the user stopped is not a failure of the server,
      // a retry would wait and fail again.
      const spent = !retryable || attempt >= maxRetries;
      if (!controller.signal.aborted && spent && !route.onFallback && options.fallback && isAvailabilityError(error)) {
        // The chat model is not available: the request runs again on the
        // fallback model with a fresh count of the retries.
        route.onFallback = true;
        attempt = 0;
        if (emitted) {
          options.onEvent({ type: 'assistant_reset' });
        }
        options.onEvent({ type: 'model_fallback', from: options.model, to: options.fallback.model });
        options.logger.info('MiniMax model ' + options.model + ' failed, falling back to ' + options.fallback.model);
        continue;
      }
      if (controller.signal.aborted || spent) {
        const message = error instanceof Error ? error.message : String(error);
        options.onEvent({ type: 'error', message });
        throw error;
      }
      const delay = retryDelay(attempt, baseDelay);
      attempt += 1;
      if (emitted) {
        // The answer broke in the middle: the piece that came is not the
        // answer, the whole request runs again.
        options.onEvent({ type: 'assistant_reset' });
      }
      options.onEvent({
        type: 'retrying',
        attempt,
        total: maxRetries,
        delayMs: delay
      });
      options.logger.info(
        'retrying MiniMax request in ' + delay + 'ms: ' + error.message
      );
      await waitBeforeRetry(controller, delay);
    }
  }
}
