import { mapHttpError, MiniMaxApiError } from './errors';
import { StreamDecoder } from './sse';
import type { ChatRequest, StreamEvent } from './types';

export interface MiniMaxClient {
  stream(request: ChatRequest, options?: { signal?: AbortSignal }): AsyncGenerator<StreamEvent>;
}

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

  constructor(options: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
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
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunk = utf8.decode(value, { stream: true });
        for (const event of decoder.push(chunk)) {
          yield event;
        }
      }
    } finally {
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
    for (const event of decoder.flush()) {
      yield event;
    }
  }
}
