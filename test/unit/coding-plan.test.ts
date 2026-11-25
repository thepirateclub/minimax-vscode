import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codingPlanUrl, formatSearch, understandImage, webSearch } from '../../src/api/codingPlan';
import { createWebTools, imageSource } from '../../src/tools/web';
import { ToolRegistry } from '../../src/tools/registry';

function fakeFetch(body: unknown, seen: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

// The M Plan key opens the web search and the vision model, the endpoints of
// the official minimax-coding-plan-mcp.
describe('the coding plan endpoints', () => {
  it('builds the address from the root of the API', () => {
    expect(codingPlanUrl('https://api.minimax.io/anthropic', 'search')).toBe('https://api.minimax.io/v1/coding_plan/search');
    expect(codingPlanUrl('https://api.minimaxi.com/anthropic/', 'vlm')).toBe('https://api.minimaxi.com/v1/coding_plan/vlm');
  });

  it('searches with the key and gives the results as lines', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const text = await webSearch(
      {
        baseUrl: 'https://api.minimax.io/anthropic',
        apiKey: 'sk-test',
        fetchImpl: fakeFetch(
          { organic: [{ title: 'Vitest', link: 'https://vitest.dev', snippet: 'Next gen testing', date: '2026' }], base_resp: { status_code: 0 } },
          seen
        )
      },
      'vitest config'
    );
    expect(text).toBe('1. Vitest\nhttps://vitest.dev\nNext gen testing\nDate: 2026');
    expect(seen[0]!.init.body).toBe('{"q":"vitest config"}');
    expect((seen[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('gives another shape of the answer as json and names a refusal', async () => {
    expect(formatSearch({ answer: 'x', base_resp: { status_code: 0 } })).toBe('{\n  "answer": "x"\n}');
    await expect(
      understandImage(
        { baseUrl: 'https://h/anthropic', apiKey: 'k', fetchImpl: fakeFetch({ base_resp: { status_code: 1004, status_msg: 'bad key' } }, []) },
        'what',
        'data:image/png;base64,AA'
      )
    ).rejects.toThrow('1004 bad key');
  });

  it('turns a file of the workspace into a data URL and keeps out the rest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-img-'));
    await writeFile(join(root, 'shot.png'), Buffer.from([1, 2, 3]));
    expect(await imageSource(root, '@shot.png')).toBe('data:image/png;base64,AQID');
    expect(await imageSource(root, 'https://x.io/a.jpg')).toBe('https://x.io/a.jpg');
    await expect(imageSource(root, 'notes.gif')).rejects.toThrow('PNG, JPEG and WebP');
    await expect(imageSource(root, '../out.png')).rejects.toThrow();
  });

  it('hides the web search from the model until the user turns it on', () => {
    let enabled = false;
    const registry = new ToolRegistry();
    for (const tool of createWebTools({ connection: async () => undefined, webSearchEnabled: () => enabled })) {
      registry.register(tool);
    }
    expect(registry.toAnthropicTools('code').map((tool) => tool.name)).toEqual(['understand_image', 'read_image']);
    enabled = true;
    expect(registry.toAnthropicTools('plan').map((tool) => tool.name)).toEqual(['web_search', 'understand_image', 'read_image']);
  });
});
