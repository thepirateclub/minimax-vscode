import { mapHttpError, MiniMaxApiError } from './errors';
import { IdleTimeoutError, IdleWatchdog } from './idleWatchdog';
import { StreamDecoder } from './sse';
import type { ChatRequest, StreamEvent } from './types';

export interface MiniMaxClient {
  stream(request: ChatRequest, options?: { signal?: AbortSignal }): AsyncGenerator<StreamEvent>;
}

// How long the connection may stay quiet before the client gives up. A
// stream that hangs without data and without a close waits forever, the
// repeats of the agent never start because no error comes.
export const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

export function buildRequestBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: request.messages,
    stream: true
  };
  if (request.tools && request.tools.length > 0) {
    body['tools'] = request.tools;
  }
  // The caller sends the effort only for the models that take the levels
  // of the depth, the catalog decides. The client knows nothing about the
  // names of the models.
  if (request.effort !== undefined) {
    body['output_config'] = { effort: request.effort };
  } else if (request.thinking === 'adaptive') {
    body['thinking'] = { type: 'adaptive' };
  }
  return body;
}

export class HttpMiniMaxClient implements MiniMaxClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  // How long the stream may stay quiet. The tests use a small value, a real
  // turn waits a minute and a half.
  private readonly idleTimeoutMs: number;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    fetchImpl?: typeof fetch;
    idleTimeoutMs?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  }

  async *stream(request: ChatRequest, options?: { signal?: AbortSignal }): AsyncGenerator<StreamEvent> {
    const url = this.baseUrl + '/v1/messages';
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(buildRequestBody(request)),
        signal: options?.signal ?? request.signal
      });
    } catch (error) {
      if (error instanceof MiniMaxApiError) {
        throw error;
      }
      throw new MiniMaxApiError(
        'Network error while contacting MiniMax: ' +
          (error instanceof Error ? error.message : String(error)),
        0,
        undefined,
        true
      );
    }

    if (!response.ok) {
      throw await mapHttpError(response);
    }
    if (!response.body) {
      throw new MiniMaxApiError(
        'MiniMax returned an empty response body.',
        response.status,
        undefined,
        true
      );
    }

    const decoder = new StreamDecoder();
    const reader = response.body.getReader();
    const utf8 = new TextDecoder();
    // The watchdog of the stream: a connection that hangs without data and
    // without a close waits forever otherwise. The read is cut, the agent
    // sees an error and repeats the request.
    const idle = new IdleWatchdog(this.idleTimeoutMs);
    try {
      for (;;) {
        idle.kick();
        const { done, value } = await idle.race(reader.read());
        if (done) {
          break;
        }
        const chunk = utf8.decode(value, { stream: true });
        for (const event of decoder.push(chunk)) {
          if (event.type === 'stream_error') {
            // The server failed in the middle of the answer: the request is
            // repeated by the agent.
            throw new MiniMaxApiError(event.message, response.status, undefined, true);
          }
          yield event;
        }
      }
    } catch (error) {
      if (error instanceof MiniMaxApiError) {
        throw error;
      }
      // The user stopped the turn, the cancellation is not a failure.
      if (options?.signal?.aborted || request.signal?.aborted) {
        throw error;
      }
      // The stream went quiet: the server did not answer, the request goes
      // out again.
      if (error instanceof IdleTimeoutError) {
        throw new MiniMaxApiError(error.message, 0, undefined, true);
      }
      // The connection broke in the middle of the answer.
      throw new MiniMaxApiError(
        'The connection to MiniMax was lost: ' +
          (error instanceof Error ? error.message : String(error)),
        0,
        undefined,
        true
      );
    } finally {
      idle.stop();
      // The stream was abandoned: the budget of the goal ran out or the
      // user stopped the turn. The request has to be closed on the wire,
      // without the cancel the server keeps generating the answer to the
      // end and the socket of the extension host stays open.
      try {
        await reader.cancel();
      } catch {
        // The stream is over or broken, there is nothing to cancel.
      }
      reader.releaseLock();
    }
    if (!decoder.finished) {
      // The stream ended without the event of the server: the answer was cut.
      // An empty answer is a lie, the request goes out again.
      throw new MiniMaxApiError(
        'The connection to MiniMax was closed before the answer ended.',
        0,
        undefined,
        true
      );
    }
    for (const event of decoder.flush()) {
      yield event;
    }
  }
}
