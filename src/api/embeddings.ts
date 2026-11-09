import { mapHttpError, MiniMaxApiError } from './errors';

export type EmbeddingType = 'query' | 'db';

// The model of the embeddings of MiniMax, it returns 1024 numbers per text.
export const DEFAULT_EMBEDDING_MODEL = 'embo-01';

// The messages endpoint lives under /anthropic, the embeddings at the root.
export function embeddingsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '');
  return root + '/v1/embeddings';
}

interface EmbeddingsBody {
  vectors?: number[][] | null;
  base_resp?: { status_code?: number; status_msg?: string };
}

export function parseEmbeddingsPayload(payload: unknown): number[][] {
  const body = (payload ?? {}) as EmbeddingsBody;
  const code = body.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    throw new MiniMaxApiError(
      'MiniMax embeddings failed: ' + (body.base_resp?.status_msg ?? 'unknown error'),
      200,
      code,
      false
    );
  }
  const vectors = body.vectors;
  if (!Array.isArray(vectors) || vectors.length === 0) {
    throw new MiniMaxApiError('MiniMax returned no embeddings.', 200, undefined, true);
  }
  return vectors;
}

export interface EmbeddingsClient {
  embed(texts: string[], type?: EmbeddingType): Promise<number[][]>;
}

export class HttpEmbeddingsClient implements EmbeddingsClient {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    model?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.url = embeddingsUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_EMBEDDING_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[], type: EmbeddingType = 'query'): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.apiKey
      },
      body: JSON.stringify({ model: this.model, type, texts })
    });
    if (!response.ok) {
      throw await mapHttpError(response);
    }
    return parseEmbeddingsPayload(await response.json());
  }
}
