import { describe, expect, it } from 'vitest';
import { buildRequestBody, HttpMiniMaxClient } from '../../src/api/client';
import { MiniMaxApiError } from '../../src/api/errors';
import type { ChatRequest, StreamEvent } from '../../src/api/types';

const REQUEST: ChatRequest = {
  model: 'MiniMax-M3.1-Flash',
  maxTokens: 1024,
  system: 'system',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
};

const BLOCK_START =
  'event: content_block_start\n' +
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n';
const TEXT_FIRST =
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n';
const TEXT_SECOND =
  'event: content_block_delta\n' +
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n';
const STOP =
  'event: message_stop\n' + 'data: {"type":"message_stop"}\n\n';

interface Body {
  response: Response;
  // The stream of the body was cancelled, the request was closed on the
  // wire.
  cancelled: () => boolean;
}

// A body of the response: a stream of chunks and the flag that it was
// cancelled.
function bodyOf(chunks: string[], broken?: Error): Body {
  const encoder = new TextEncoder();
  let cancelled = false;
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index += 1;
        return;
      }
      if (broken) {
        controller.error(broken);
        return;
      }
      controller.close();
    },
    cancel() {
      cancelled = true;
    }
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }),
    cancelled: () => cancelled
  };
}

function clientOf(body: Body, idleTimeoutMs?: number): HttpMiniMaxClient {
  return new HttpMiniMaxClient({
    baseUrl: 'https://api.test',
    apiKey: 'test-key',
    fetchImpl: async () => body.response,
    idleTimeoutMs
  });
}

// A body that never sends anything and never closes: the connection hangs.
function silentBody(): Body {
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      // Nothing comes, the connection stays open.
    }
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }),
    cancelled: () => false
  };
}

describe('the body of the request', () => {
  it('carries the effort when the caller sends it', () => {
    const body = buildRequestBody({ ...REQUEST, effort: 'high' });
    expect(body['output_config']).toEqual({ effort: 'high' });
    expect(body['thinking']).toBeUndefined();
  });

  it('carries no effort when the model takes none', () => {
    const body = buildRequestBody({ ...REQUEST, effort: undefined });
    expect(body['output_config']).toBeUndefined();
    expect(body['thinking']).toBeUndefined();
  });

  it('carries the adaptive thinking for the model without the depth', () => {
    const body = buildRequestBody({
      ...REQUEST,
      model: 'MiniMax-M3',
      thinking: 'adaptive'
    });
    expect(body['thinking']).toEqual({ type: 'adaptive' });
    expect(body['output_config']).toBeUndefined();
  });
});

describe('the client of MiniMax', () => {
  it('cancels the request when the stream is abandoned', async () => {
    const body = bodyOf([BLOCK_START, TEXT_FIRST, TEXT_SECOND, STOP]);
    const client = clientOf(body);
    const events: StreamEvent[] = [];
    // The reading stops in the middle of the answer: the budget of the goal
    // ran out or the user stopped the turn.
    for await (const event of client.stream(REQUEST)) {
      events.push(event);
      break;
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('text_delta');
    // The request is closed on the wire, the server stops the answer
    // instead of generating it to the end.
    expect(body.cancelled()).toBe(true);
  });

  it('reads the stream to the end and leaves it alone', async () => {
    const body = bodyOf([BLOCK_START, TEXT_FIRST, TEXT_SECOND, STOP]);
    const client = clientOf(body);
    const events: StreamEvent[] = [];
    for await (const event of client.stream(REQUEST)) {
      events.push(event);
    }
    const text = events
      .filter((event): event is Extract<StreamEvent, { type: 'text_delta' }> =>
        event.type === 'text_delta'
      )
      .map((event) => event.text)
      .join('');
    expect(text).toBe('Hello');
    expect(events.at(-1)?.type).toBe('message_stop');
    // The stream was read to the end, there is nothing to cancel.
    expect(body.cancelled()).toBe(false);
  });

  it('keeps the error of a broken stream', async () => {
    const body = bodyOf([BLOCK_START, TEXT_FIRST], new Error('the connection broke'));
    const client = clientOf(body);
    const read = async (): Promise<void> => {
      for await (const event of client.stream(REQUEST)) {
        void event;
      }
    };
    // The error of the stream reaches the caller, the cancel of the reader
    // does not replace it.
    await expect(read()).rejects.toThrow('the connection broke');
  });

  it('reports a stream that ended before the answer ended', async () => {
    const body = bodyOf([BLOCK_START, TEXT_FIRST]);
    const client = clientOf(body);
    const read = async (): Promise<void> => {
      for await (const event of client.stream(REQUEST)) {
        void event;
      }
    };
    // The stream ended without the event of the server. An empty answer
    // would be a lie, the request goes out again.
    const failure = await read().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MiniMaxApiError);
    expect((failure as MiniMaxApiError).retryable).toBe(true);
    expect((failure as Error).message).toContain(
      'The connection to MiniMax was closed before the answer ended.'
    );
  });

  it('gives up on a stream that stays silent', async () => {
    // The connection hangs: no data and no close. Without the watchdog the
    // read waits forever and the request is never repeated.
    const client = clientOf(silentBody(), 50);
    const read = async (): Promise<void> => {
      for await (const event of client.stream(REQUEST)) {
        void event;
      }
    };
    const failure = await read().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MiniMaxApiError);
    expect((failure as MiniMaxApiError).retryable).toBe(true);
    expect((failure as Error).message).toContain('stopped sending data');
  });

  it('reports the error of the server in the middle of the answer', async () => {
    const errorEvent =
      'event: error\n' + 'data: {"type":"error","error":{"message":"overloaded"}}\n\n';
    const body = bodyOf([BLOCK_START, TEXT_FIRST, errorEvent]);
    const client = clientOf(body);
    const read = async (): Promise<void> => {
      for await (const event of client.stream(REQUEST)) {
        void event;
      }
    };
    const failure = await read().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MiniMaxApiError);
    expect((failure as MiniMaxApiError).retryable).toBe(true);
    expect((failure as Error).message).toContain('overloaded');
  });
});
