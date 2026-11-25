import { describe, expect, it } from 'vitest';
import { isPrivateAddress, refuseAddress } from '../../src/tools/web/address';
import { createWebFetchTool } from '../../src/tools/web/fetch';
import type { ToolContext } from '../../src/tools/types';

// web_fetch goes out without asking: it must not read the local network of
// the user, the router or the cloud metadata service.
const ctx = { workspaceRoot: '/w', signal: new AbortController().signal } as unknown as ToolContext;

describe('the guard of web_fetch', () => {
  it('knows the private, loopback and link-local addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '140.82.112.3', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('refuses localhost, a local IP and a name that points to one', async () => {
    expect(await refuseAddress('http://localhost:3000/')).toContain('local network');
    expect(await refuseAddress('http://[::1]/')).toContain('local network');
    expect(await refuseAddress('http://169.254.169.254/latest/meta-data/')).toContain('local network');
    expect(await refuseAddress('https://evil.example/', async () => ['127.0.0.1'])).toContain('points to the local address 127.0.0.1');
    expect(await refuseAddress('https://example.com/', async () => ['93.184.215.14'])).toBeUndefined();
  });

  it('does not follow a redirect of a public page to the local network', async () => {
    const seen: string[] = [];
    const entry = createWebFetchTool({
      fetchImpl: (async (url: string) => {
        seen.push(url);
        return new Response('', { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } });
      }) as unknown as typeof fetch
    });
    const result = await entry.execute({ url: 'https://example.com/go' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('local network');
    expect(seen).toEqual(['https://example.com/go']);
  });

  it('follows a public redirect and names the final address', async () => {
    const entry = createWebFetchTool({
      fetchImpl: (async (url: string) =>
        url.endsWith('/old')
          ? new Response('', { status: 301, headers: { location: '/new' } })
          : new Response('hello', { status: 200, headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch
    });
    const result = await entry.execute({ url: 'https://example.com/old' }, ctx);
    expect(result.content).toContain('https://example.com/new');
    expect(result.content).toContain('hello');
  });
});
