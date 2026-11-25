import type { ToolEntry } from '../types';
import { htmlToText } from './html';
import { refuseAddress, resolveHost, type Resolve } from './address';

// The page comes from the machine of the user: the key of the M Plan is not
// needed, nothing is changed on the disk and nobody is asked. The tool only
// reads, so it works in the plan mode too.

export const WEB_FETCH_TIMEOUT_MS = 25_000;
export const WEB_FETCH_MAX_BYTES = 2 * 1024 * 1024;

// The host of the files of a repository: such an address is a file, it comes
// as it is on the disk, without the reading of a page.
const RAW_HOST = 'raw.githubusercontent.com';

// The types that hold text. Everything else is a picture, an archive or a
// program, it does not come to the model.
const TEXT_TYPES = new Set([
  'application/json',
  'application/javascript',
  'application/x-javascript',
  'application/ecmascript',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/sql',
  'application/graphql',
  'application/xml',
  'application/rtf',
  'application/x-sh'
]);

// The types of a page of the web.
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

export interface WebFetchOptions {
  // The network of the test, the real one by default.
  fetchImpl?: typeof fetch;
  // How long the address may answer.
  timeoutMs?: number;
  // How much of the answer may come to the model.
  maxBytes?: number;
  // The resolver of the names for the guard of the local network. The real
  // DNS with the real network; a test with a fake network checks only the
  // literal addresses.
  resolve?: Resolve;
}

// A public page may redirect to the local network: every hop is checked.
const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export interface FetchedPage {
  // The address after the redirects.
  url: string;
  contentType: string;
  bytes: number;
  body: string;
}

// The type of the answer without its parameters.
export function baseType(contentType: string): string {
  return contentType.split(';')[0]?.trim().toLowerCase() ?? '';
}

// The answer holds text and the model can read it.
export function isTextType(contentType: string): boolean {
  const type = baseType(contentType);
  if (!type) {
    return false;
  }
  if (type.startsWith('text/')) {
    return true;
  }
  if (type.endsWith('+json') || type.endsWith('+xml')) {
    return true;
  }
  return TEXT_TYPES.has(type);
}

// The answer is a page of the web.
export function isHtmlType(contentType: string): boolean {
  return HTML_TYPES.has(baseType(contentType));
}

// The address of a file of a repository.
export function isRawHost(host: string): boolean {
  return host.toLowerCase() === RAW_HOST;
}

// The page looks like html even when the server says nothing about it.
export function looksLikeHtml(text: string): boolean {
  return (
    /<!doctype\s+html/i.test(text) ||
    /<html[\s>]/i.test(text) ||
    /<\/(p|div|span|h[1-6]|body|head|title|ul|ol|li|table|a)>/i.test(text)
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return bytes + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function failure(error: unknown): { content: string; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return { content: 'web_fetch failed: ' + message, isError: true };
}

// The body of the answer, but not more than the limit: a page of fifty
// megabytes must not fall into the context of the model.
async function readLimited(
  response: Response,
  maxBytes: number
): Promise<{ bytes: number; text: string }> {
  const decoder = new TextDecoder('utf-8');
  if (!response.body) {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      throw new Error('the answer is bigger than the limit of ' + formatBytes(maxBytes));
    }
    return { bytes, text };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('the answer is bigger than the limit of ' + formatBytes(maxBytes));
    }
    chunks.push(value);
  }
  const whole = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, text: decoder.decode(whole) };
}

// The page of the address. The wait is cut by the time of the limit and by
// the cancel of the turn.
export async function fetchPage(
  url: string,
  options: {
    fetchImpl: typeof fetch;
    signal: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
    resolve?: Resolve;
  }
): Promise<FetchedPage> {
  if (options.signal.aborted) {
    throw new Error('the turn was cancelled');
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  const onAbort = () => controller.abort();
  options.signal.addEventListener('abort', onAbort, { once: true });
  try {
    let current = url;
    let response: Response;
    for (let hop = 0; ; hop++) {
      const refused = await refuseAddress(current, options.resolve);
      if (refused) {
        throw new Error(refused);
      }
      // The turn may be cancelled while the name is resolved.
      if (options.signal.aborted) {
        throw new Error('the turn was cancelled');
      }
      response = await options.fetchImpl(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'MiniMax-Agent',
          Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8'
        }
      });
      const location = response.headers.get('location');
      if (!REDIRECTS.has(response.status) || !location) {
        break;
      }
      if (hop >= MAX_REDIRECTS) {
        throw new Error('the address redirects more than ' + MAX_REDIRECTS + ' times');
      }
      current = new URL(location, current).toString();
    }
    if (!response.ok) {
      const status = response.status + (response.statusText ? ' ' + response.statusText : '');
      throw new Error('the server answered ' + status);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      throw new Error(
        'the answer is bigger than the limit of ' +
          formatBytes(options.maxBytes) +
          ': ' +
          declared +
          ' bytes'
      );
    }
    const body = await readLimited(response, options.maxBytes);
    return { url: response.url || current, contentType, bytes: body.bytes, body: body.text };
  } catch (error) {
    if (timedOut) {
      const limit =
        options.timeoutMs >= 1000
          ? Math.round(options.timeoutMs / 1000) + ' seconds'
          : options.timeoutMs + ' ms';
      throw new Error('the address did not answer in ' + limit);
    }
    if (options.signal.aborted) {
      throw new Error('the turn was cancelled');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener('abort', onAbort);
  }
}

// The tool of the page: it takes the address and gives the content of it.
export function createWebFetchTool(options: WebFetchOptions = {}): ToolEntry {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEB_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? WEB_FETCH_MAX_BYTES;
  const resolve = options.resolve ?? (options.fetchImpl ? undefined : resolveHost);
  return {
    name: 'web_fetch',
    description:
      'Get the content of a page by its address: the text of an html page without the markup, the scripts and the navigation, or the file of raw.githubusercontent.com as it is, without any change. Use it when you know the address of a document, a source file, a readme or a config. The page comes from the machine of the user, no key is needed.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The address of the page, http or https.' }
      },
      required: ['url']
    },
    async execute(input, ctx) {
      const address = String(input['url'] ?? '').trim();
      if (!address) {
        return failure('the address is empty');
      }
      let target: URL;
      try {
        target = new URL(address);
      } catch {
        return failure('the address is not a link: ' + address);
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return failure(
          'only the addresses http and https are allowed, this one is ' + target.protocol
        );
      }
      let page: FetchedPage;
      try {
        page = await fetchPage(target.toString(), {
          fetchImpl,
          signal: ctx.signal,
          timeoutMs,
          maxBytes,
          resolve
        });
      } catch (error) {
        return failure(error);
      }
      // A picture, an archive or a program does not come to the model as
      // text, the type of it is named instead.
      if (baseType(page.contentType) && !isTextType(page.contentType)) {
        return failure('the answer is not a text, it is ' + page.contentType);
      }
      if (!baseType(page.contentType) && page.body.slice(0, 2000).includes('\u0000')) {
        return failure('the answer is a binary file');
      }
      // The file of a repository comes as it is, the page is read.
      const raw = isRawHost(target.hostname);
      const html = !raw && (isHtmlType(page.contentType) || looksLikeHtml(page.body));
      let title = '';
      let text = page.body;
      if (html) {
        const parsed = htmlToText(page.body);
        title = parsed.title;
        text = parsed.text;
      }
      if (text.trim().length === 0) {
        return failure('the answer of the page is empty');
      }
      const head = [
        'web_fetch: ' + target.toString(),
        'Final URL: ' + page.url,
        'Type: ' + (page.contentType || 'unknown'),
        'Size: ' + formatBytes(page.bytes) + ' (' + page.bytes + ' bytes)',
        'Mode: ' + (raw ? 'the file as it is' : 'the text of the page')
      ];
      if (title) {
        head.push('Title: ' + title);
      }
      return { content: head.join('\n') + '\n\n' + text };
    }
  };
}
