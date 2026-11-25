import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createAllTools } from '../../src/tools/all';
import { createWebFetchTool } from '../../src/tools/web/fetch';
import { createWebTools } from '../../src/tools/web';
import { ToolRegistry } from '../../src/tools/registry';
import { describerNames } from '../../src/ui/webview/components/toolDescriptions/table';

const PAGE =
  '<html><head><title>The docs of the thing</title>' +
  '<style>body { color: red; }</style><script>alert(1);</script></head>' +
  '<body><nav>Home About</nav><h1>The heading</h1>' +
  '<p>The first paragraph &amp; more.</p></body></html>';

const RAW = '# The readme\n\n  const a = 1;\n  a &amp; b\n';

function makeContext(signal?: AbortSignal) {
  return {
    workspaceRoot: 'C:\\work',
    signal: signal ?? new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined }
  };
}

// The network never comes into the test: the answer is given by the stub.
function fakeFetch(options: {
  body?: string;
  status?: number;
  headers?: Record<string, string>;
  url?: string;
  seen?: Array<{ url: string; init: RequestInit }>;
}): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    options.seen?.push({ url, init });
    const response = new Response(options.body ?? '', {
      status: options.status ?? 200,
      headers: options.headers ?? { 'content-type': 'text/html; charset=utf-8' }
    });
    if (options.url) {
      Object.defineProperty(response, 'url', { value: options.url });
    }
    return response;
  }) as unknown as typeof fetch;
}

describe('the tool web_fetch', () => {
  it('is in the list of the tools of the extension', () => {
    const tools = createAllTools({
      backups: new InMemoryBackupStore(),
      search: () => undefined,
      spawn: async () => ({ content: 'the child did not run in the test' })
    });
    expect(tools.map((tool) => tool.name)).toContain('web_fetch');
  });

  it('has a row in the table of the descriptions of the cards', () => {
    // A tool without a row falls to the generic card, the reader sees the
    // raw name of the tool instead of the action.
    expect(describerNames()).toContain('web_fetch');
  });

  it('has no side effect, plan mode keeps it and it never asks', () => {
    const entry = createWebFetchTool();
    const registry = new ToolRegistry();
    registry.register(entry);
    expect(entry.sideEffect).toBe(false);
    expect(entry.approval).toBe('never');
    expect(registry.isAllowed(entry, 'plan')).toBe(true);
    expect(registry.isAllowed(entry, 'code')).toBe(true);
  });

  it('works without the key of the M Plan', async () => {
    // The page comes from the machine of the user, the key is not needed.
    const tools = createWebTools({
      connection: async () => undefined,
      webSearchEnabled: () => false,
      fetchImpl: fakeFetch({ body: PAGE })
    });
    const entry = tools.find((tool) => tool.name === 'web_fetch');
    expect(entry).toBeDefined();
    const result = await entry!.execute({ url: 'https://example.com/docs' }, makeContext());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('The heading');
  });

  it('turns a page into readable text', async () => {
    const entry = createWebFetchTool({ fetchImpl: fakeFetch({ body: PAGE }) });
    const result = await entry.execute({ url: 'https://example.com/docs' }, makeContext());
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('The heading');
    expect(result.content).toContain('The first paragraph & more.');
    // The markup of the page does not come to the model.
    expect(result.content).not.toContain('<');
    expect(result.content).not.toContain('alert(1)');
    expect(result.content).not.toContain('color: red');
    expect(result.content).not.toContain('Home About');
    expect(result.content).not.toContain('&amp;');
  });

  it('names the address, the final address, the type and the size', async () => {
    const entry = createWebFetchTool({
      fetchImpl: fakeFetch({
        body: PAGE,
        url: 'https://example.com/docs/index.html',
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    });
    const result = await entry.execute({ url: 'https://example.com/docs' }, makeContext());
    expect(result.content).toContain('https://example.com/docs');
    expect(result.content).toContain('https://example.com/docs/index.html');
    expect(result.content).toContain('text/html');
    expect(result.content).toMatch(/\d+ bytes/);
    // The title of the page comes apart from the text of it.
    expect(result.content).toContain('The docs of the thing');
  });

  it('keeps the file of raw.githubusercontent.com as it is', async () => {
    const entry = createWebFetchTool({
      fetchImpl: fakeFetch({
        body: RAW,
        headers: { 'content-type': 'text/plain; charset=utf-8' }
      })
    });
    const result = await entry.execute(
      { url: 'https://raw.githubusercontent.com/owner/repo/main/README.md' },
      makeContext()
    );
    expect(result.isError).toBeFalsy();
    // The file comes as it is on the disk: the spaces of the code stay and
    // the entities of the file are not expanded.
    expect(result.content).toContain('  const a = 1;');
    expect(result.content).toContain('a &amp; b');
    expect(result.content).not.toContain('a & b');
  });

  it('refuses an address of another scheme', async () => {
    const entry = createWebFetchTool({ fetchImpl: fakeFetch({ body: PAGE }) });
    for (const url of ['file:///c:/secret.txt', 'data:text/html,hello', 'ftp://example.com/a.txt']) {
      const result = await entry.execute({ url }, makeContext());
      expect(result.isError).toBe(true);
      expect(result.content).toContain('http');
    }
  });

  it('refuses a call without an address', async () => {
    const entry = createWebFetchTool({ fetchImpl: fakeFetch({ body: PAGE }) });
    const result = await entry.execute({}, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('address');
  });

  it('refuses a binary answer and names its type', async () => {
    const entry = createWebFetchTool({
      fetchImpl: fakeFetch({
        body: 'not a text',
        headers: { 'content-type': 'image/png' }
      })
    });
    const result = await entry.execute({ url: 'https://example.com/a.png' }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('image/png');
  });

  it('refuses an answer bigger than the limit', async () => {
    const entry = createWebFetchTool({
      fetchImpl: fakeFetch({
        body: 'x'.repeat(500),
        headers: { 'content-type': 'text/plain' }
      }),
      maxBytes: 100
    });
    const result = await entry.execute({ url: 'https://example.com/big.txt' }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('limit');
  });

  it('refuses an answer that lies about its size', async () => {
    const entry = createWebFetchTool({
      fetchImpl: fakeFetch({
        body: 'small',
        headers: { 'content-type': 'text/plain', 'content-length': '50000000' }
      }),
      maxBytes: 100
    });
    const result = await entry.execute({ url: 'https://example.com/big.txt' }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('limit');
  });

  it('reports an empty answer', async () => {
    const entry = createWebFetchTool({
      fetchImpl: fakeFetch({ body: '', headers: { 'content-type': 'text/html' } })
    });
    const result = await entry.execute({ url: 'https://example.com/empty' }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('empty');
  });

  it('reports a failure of the network', async () => {
    const entry = createWebFetchTool({
      fetchImpl: (async () => {
        throw new Error('getaddrinfo ENOTFOUND example.com');
      }) as unknown as typeof fetch
    });
    const result = await entry.execute({ url: 'https://example.com/docs' }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('ENOTFOUND');
  });

  it('reports a status of the server', async () => {
    const entry = createWebFetchTool({
      fetchImpl: fakeFetch({ body: 'gone', status: 404, headers: { 'content-type': 'text/html' } })
    });
    const result = await entry.execute({ url: 'https://example.com/gone' }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('404');
  });

  it('stops when the turn is cancelled', async () => {
    const controller = new AbortController();
    const entry = createWebFetchTool({
      fetchImpl: (async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch
    });
    const promise = entry.execute({ url: 'https://example.com/slow' }, makeContext(controller.signal));
    controller.abort();
    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.content).toContain('cancel');
  });

  it('gives up when the address does not answer in time', async () => {
    const entry = createWebFetchTool({
      fetchImpl: (async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch,
      timeoutMs: 50
    });
    const result = await entry.execute({ url: 'https://example.com/slow' }, makeContext());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('did not answer');
  });

  it('gives the signal of the turn to the network', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const entry = createWebFetchTool({ fetchImpl: fakeFetch({ body: PAGE, seen }) });
    await entry.execute({ url: 'https://example.com/docs' }, makeContext());
    expect(seen[0]?.url).toBe('https://example.com/docs');
    expect(seen[0]?.init.signal).toBeDefined();
  });
});
