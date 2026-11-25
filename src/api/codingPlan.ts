// The tools of the M Plan beyond the chat: the web search and the reading of
// an image. The official minimax-coding-plan-mcp calls the same endpoints
// with the same key: POST {api-root}/v1/coding_plan/search with {q} and
// POST {api-root}/v1/coding_plan/vlm with {prompt, image_url}, the image is
// a data URL. The answer carries base_resp like the other endpoints.

export interface CodingPlanOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

const MAX_RESULTS = 8;

export function codingPlanUrl(baseUrl: string, path: 'search' | 'vlm'): string {
  const root = baseUrl.replace(/\/anthropic\/?$/, '').replace(/\/+$/, '');
  return root + '/v1/coding_plan/' + path;
}

async function post(
  options: CodingPlanOptions,
  path: 'search' | 'vlm',
  body: unknown
): Promise<Record<string, unknown>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(codingPlanUrl(options.baseUrl, path), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + options.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (!response.ok) {
    throw new Error('MiniMax answered ' + response.status + ' to the ' + path + ' request.');
  }
  // The body is the json of the endpoint, its fields are checked below.
  const data = (await response.json()) as Record<string, unknown>;
  const base = data['base_resp'] as { status_code?: number; status_msg?: string } | undefined;
  if (base && base.status_code !== undefined && base.status_code !== 0) {
    throw new Error(
      'MiniMax refused the ' + path + ' request: ' + base.status_code + ' ' + (base.status_msg ?? '')
    );
  }
  return data;
}

// The results as lines for the model: the title, the link, the snippet. An
// answer of another shape goes as json, cut to a size the model can read.
export function formatSearch(data: Record<string, unknown>): string {
  const organic = data['organic'];
  if (Array.isArray(organic)) {
    const rows = organic.slice(0, MAX_RESULTS).map((item: unknown, index) => {
      const row = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const parts = [
        index + 1 + '. ' + String(row['title'] ?? '').trim(),
        String(row['link'] ?? row['url'] ?? '')
      ];
      const snippet = String(row['snippet'] ?? '').trim();
      if (snippet) {
        parts.push(snippet);
      }
      const date = String(row['date'] ?? '').trim();
      if (date) {
        parts.push('Date: ' + date);
      }
      return parts.join('\n');
    });
    return rows.length > 0 ? rows.join('\n\n') : 'No results.';
  }
  const rest = { ...data };
  delete rest['base_resp'];
  return JSON.stringify(rest, null, 2).slice(0, 20_000);
}

export async function webSearch(options: CodingPlanOptions, query: string): Promise<string> {
  return formatSearch(await post(options, 'search', { q: query }));
}

export async function understandImage(
  options: CodingPlanOptions,
  prompt: string,
  imageUrl: string
): Promise<string> {
  const data = await post(options, 'vlm', { prompt, image_url: imageUrl });
  const content = data['content'];
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('MiniMax returned no description of the image.');
  }
  return content;
}
