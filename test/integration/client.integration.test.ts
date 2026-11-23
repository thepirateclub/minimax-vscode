import { afterEach, describe, expect, it } from 'vitest';
import { HttpMiniMaxClient } from '../../src/api/client';
import { MiniMaxApiError } from '../../src/api/errors';
import type { EffortLevel } from '../../src/api/types';
import { startFakeServer, type FakeServer } from './fake-server';

let server: FakeServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function collect(client: HttpMiniMaxClient, model: string, effort?: EffortLevel) {
  const events = [];
  for await (const event of client.stream({
    model,
    maxTokens: 32000,
    system: 'sys',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    effort
  })) {
    events.push(event);
  }
  return events;
}

describe('HttpMiniMaxClient', () => {
  it('sends a bearer token and the anthropic shape', async () => {
    server = await startFakeServer();
    const client = new HttpMiniMaxClient({ baseUrl: server.url + '/anthropic', apiKey: 'test-key' });
    const events = await collect(client, 'MiniMax-M3.1-Flash', 'max');
    const request = server.requests[0];
    expect(request?.headers['authorization']).toBe('Bearer test-key');
    expect(request?.headers['x-api-key']).toBeUndefined();
    const body = JSON.parse(request?.body ?? '{}');
    expect(body.model).toBe('MiniMax-M3.1-Flash');
    expect(body.max_tokens).toBe(32000);
    expect(body.stream).toBe(true);
    expect(body.system).toBe('sys');
    expect(body.output_config).toEqual({ effort: 'max' });
    expect(body.thinking).toBeUndefined();
    const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    expect(text).toBe('hi');
    const stop = events.find((e) => e.type === 'message_stop');
    expect(stop?.stopReason).toBe('end_turn');
  });

  it('omits effort when the caller sends none', async () => {
    server = await startFakeServer();
    const client = new HttpMiniMaxClient({ baseUrl: server.url, apiKey: 'k' });
    await collect(client, 'MiniMax-M3');
    const body = JSON.parse(server.requests[0]?.body ?? '{}');
    expect(body.output_config).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  it('maps an invalid key to a non retryable error', async () => {
    server = await startFakeServer({
      status: 401,
      body: '{"error":{"type":"authentication_error","message":"invalid api key"}}'
    });
    const client = new HttpMiniMaxClient({ baseUrl: server.url, apiKey: 'bad' });
    await expect(collect(client, 'MiniMax-M3.1-Flash')).rejects.toBeInstanceOf(MiniMaxApiError);
  });

  it('maps 429 to a retryable error', async () => {
    server = await startFakeServer({ status: 429, body: '{"error":{"message":"rate limited"}}' });
    const client = new HttpMiniMaxClient({ baseUrl: server.url, apiKey: 'k' });
    try {
      await collect(client, 'MiniMax-M3.1-Flash');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MiniMaxApiError);
      expect((error as MiniMaxApiError).retryable).toBe(true);
    }
  });
});
