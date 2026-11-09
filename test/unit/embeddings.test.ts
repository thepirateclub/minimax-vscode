import { describe, expect, it } from 'vitest';
import {
  embeddingsUrl,
  HttpEmbeddingsClient,
  parseEmbeddingsPayload
} from '../../src/api/embeddings';

describe('embeddingsUrl', () => {
  it('drops the anthropic path of the base url', () => {
    expect(embeddingsUrl('https://api.minimax.io/anthropic')).toBe(
      'https://api.minimax.io/v1/embeddings'
    );
  });

  it('drops the trailing slash as well', () => {
    expect(embeddingsUrl('https://api.minimax.io/anthropic/')).toBe(
      'https://api.minimax.io/v1/embeddings'
    );
  });

  it('keeps the region of the base url', () => {
    expect(embeddingsUrl('https://api.minimaxi.com/anthropic')).toBe(
      'https://api.minimaxi.com/v1/embeddings'
    );
  });
});

describe('parseEmbeddingsPayload', () => {
  it('returns the vectors of a good answer', () => {
    const vectors = parseEmbeddingsPayload({
      vectors: [[1, 2, 3]],
      base_resp: { status_code: 0, status_msg: 'success' }
    });
    expect(vectors).toEqual([[1, 2, 3]]);
  });

  it('throws with the message of the server', () => {
    expect(() =>
      parseEmbeddingsPayload({
        vectors: null,
        base_resp: { status_code: 1002, status_msg: 'rate limit exceeded(RPM)' }
      })
    ).toThrow(/rate limit/);
  });

  it('throws when the body has no vectors', () => {
    expect(() => parseEmbeddingsPayload({})).toThrow();
  });
});

describe('HttpEmbeddingsClient', () => {
  it('asks the embeddings endpoint and returns the vectors', async () => {
    const urls: string[] = [];
    const client = new HttpEmbeddingsClient({
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKey: 'secret',
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response(
          JSON.stringify({ vectors: [[0.1, 0.2]], base_resp: { status_code: 0 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    });
    const vectors = await client.embed(['hello']);
    expect(vectors).toEqual([[0.1, 0.2]]);
    expect(urls[0]).toBe('https://api.minimax.io/v1/embeddings');
  });

  it('sends the type of the request', async () => {
    let body = '';
    const client = new HttpEmbeddingsClient({
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKey: 'secret',
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? '');
        return new Response(
          JSON.stringify({ vectors: [[1]], base_resp: { status_code: 0 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    });
    await client.embed(['hello'], 'db');
    expect(JSON.parse(body).type).toBe('db');
    expect(JSON.parse(body).model).toBe('embo-01');
  });
});
