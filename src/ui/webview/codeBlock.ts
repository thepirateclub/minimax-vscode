import type { UiMessage } from '../protocol';
import type { CommandHint } from './commandHistory';
import { supportsLanguage } from './highlight';
import { STRINGS } from './strings';

// The header of a code block shows the name of the file when the snippet is
// a quote from a file, and the language when the model wrote the code.

export interface CodeBlockInfo {
  // What the header shows.
  title: string;
  // The language of the highlighter.
  language: string;
  // The file of the snippet, empty when the model wrote the code.
  file: string;
  // The line of the snippet inside the file, zero when it is unknown.
  line: number;
}

// A file the agent has read. The panel knows its lines and can look for a
// snippet inside it.
export interface CodeSource {
  path: string;
  lines: Array<{ number: number; text: string }>;
  // The trimmed text of a line points to its places in the file.
  positions: Map<string, number[]>;
}

export interface CodeBlockOptions {
  // The text of the snippet.
  content?: string;
  // The files the agent has read.
  sources?: CodeSource[];
  // The command that ran before the block, the header can take its name.
  command?: CommandHint;
}

export interface CodeMatch {
  path: string;
  line: number;
}

const EXTENSION_LANGUAGE: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  jsonc: 'json',
  py: 'py',
  pyw: 'py',
  java: 'java',
  kt: 'kt',
  kts: 'kt',
  scala: 'scala',
  go: 'go',
  rs: 'rs',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'cs',
  php: 'php',
  swift: 'swift',
  dart: 'dart',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  ps1: 'ps1',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  conf: 'conf',
  md: 'md',
  markdown: 'md',
  diff: 'diff',
  patch: 'diff',
  txt: 'txt',
  log: 'txt'
};

// The window of lines that has to match, more lines mean a certain match.
const MATCH_LINES = 5;
// The cache of the parsed reads, the panel renders the same text again and
// again while the answer grows.
const SOURCE_CACHE_LIMIT = 16;

function baseName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1 ? path : path.slice(cut + 1);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return '';
  }
  return name.slice(dot + 1).toLowerCase();
}

export function languageOf(path: string): string {
  return EXTENSION_LANGUAGE[extensionOf(baseName(path))] ?? 'text';
}

// The line of the snippet can follow the path, for example src/api/history.ts:42.
function splitLine(token: string): { path: string; line: number } {
  const colon = token.lastIndexOf(':');
  if (colon > 0) {
    const tail = token.slice(colon + 1);
    if (/^\d{1,6}$/.test(tail)) {
      return { path: token.slice(0, colon), line: Number(tail) };
    }
  }
  return { path: token, line: 0 };
}

function fileFromToken(token: string): { path: string; line: number } | undefined {
  const parts = splitLine(token);
  const name = baseName(parts.path);
  const extension = extensionOf(name);
  if (extension.length === 0 || !/^[a-z0-9]{1,12}$/.test(extension)) {
    return undefined;
  }
  return parts;
}

function createSource(path: string, lines: Array<{ number: number; text: string }>): CodeSource {
  const positions = new Map<string, number[]>();
  for (let index = 0; index < lines.length; index++) {
    const key = lines[index]!.text.trim();
    const list = positions.get(key);
    if (list) {
      list.push(index);
    } else {
      positions.set(key, [index]);
    }
  }
  return { path, lines, positions };
}

const SOURCE_HEADER = /^=== (.+) ===$/;
const NUMBERED_LINE = /^(\d+): ?(.*)$/;

// The result of read_file holds the number of the line in front of it, the
// panel parses it back to find the file of a snippet.
export function parseReadFileContent(
  paths: string[],
  content: string
): CodeSource[] {
  const sources: CodeSource[] = [];
  let path = paths[0] ?? '';
  let lines: Array<{ number: number; text: string }> = [];

  const flush = (): void => {
    if (lines.length > 0) {
      sources.push(createSource(path, lines));
    }
    lines = [];
  };

  for (const raw of content.split('\n')) {
    // The files of the workspace keep the windows line endings.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const header = SOURCE_HEADER.exec(line.trim());
    if (header) {
      flush();
      path = header[1]!.trim();
      continue;
    }
    const numbered = NUMBERED_LINE.exec(line);
    if (!numbered) {
      continue;
    }
    lines.push({ number: Number(numbered[1]), text: numbered[2] ?? '' });
  }
  flush();
  return sources;
}

function isEllipsis(line: string): boolean {
  return line === '...' || line === '// ...' || line === '/* ... */' || line === '# ...';
}

// A snippet can hide a part of the file, the ellipsis cuts it into pieces.
// The first piece is enough to find the file.
function snippetSegments(content: string): string[][] {
  const lines = content.split('\n').map((line) => line.replace(/\r$/, '').trim());
  const segments: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (isEllipsis(line)) {
      if (current.length > 0) {
        segments.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  const trimmed: string[][] = [];
  for (const segment of segments) {
    const start = segment.findIndex((line) => line.length > 0);
    if (start === -1) {
      continue;
    }
    let end = segment.length;
    while (end > start && segment[end - 1]!.length === 0) {
      end -= 1;
    }
    trimmed.push(segment.slice(start, end));
  }
  return trimmed;
}

// The snippet is found by its text inside the files the agent has read. The
// match has to be unique, a snippet that fits several places names no file.
export function matchSource(
  content: string,
  sources: CodeSource[]
): CodeMatch | undefined {
  if (sources.length === 0) {
    return undefined;
  }
  for (const segment of snippetSegments(content)) {
    const window = segment.slice(0, MATCH_LINES);
    const found: CodeMatch[] = [];
    for (const source of sources) {
      const candidates = source.positions.get(window[0] ?? '');
      if (!candidates) {
        continue;
      }
      for (const index of candidates) {
        if (index + window.length > source.lines.length) {
          continue;
        }
        let same = true;
        for (let offset = 0; offset < window.length; offset++) {
          if (source.lines[index + offset]!.text.trim() !== window[offset]) {
            same = false;
            break;
          }
        }
        if (same) {
          found.push({ path: source.path, line: source.lines[index]!.number });
        }
      }
    }
    if (found.length === 1) {
      return found[0];
    }
    if (found.length > 1) {
      return undefined;
    }
  }
  return undefined;
}

function readPaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const single = input['path'];
  if (typeof single === 'string' && single.trim().length > 0) {
    paths.push(single.trim());
  }
  const many = input['paths'];
  if (Array.isArray(many)) {
    for (const item of many) {
      if (typeof item === 'string' && item.trim().length > 0) {
        paths.push(item.trim());
      }
    }
  }
  return paths;
}

const sourceCache = new Map<string, CodeSource[]>();
const EMPTY_SOURCES: CodeSource[] = [];

// The files the agent has read are the sources of the snippets. The result
// keeps its identity while the reads do not change, the rows of the chat are
// not redrawn for nothing.
export function collectFileSources(messages: UiMessage[]): CodeSource[] {
  const reads: UiMessage[] = [];
  for (const message of messages) {
    const tool = message.tool;
    if (
      message.role !== 'tool' ||
      !tool ||
      tool.name !== 'read_file' ||
      tool.isError === true ||
      (tool.content ?? '').length === 0
    ) {
      continue;
    }
    reads.push(message);
  }
  if (reads.length === 0) {
    return EMPTY_SOURCES;
  }
  const signature = reads
    .map((message) => message.tool!.id + ':' + message.tool!.content!.length)
    .join('|');
  const cached = sourceCache.get(signature);
  if (cached) {
    return cached;
  }
  // The same file can be read twice, the lines of the reads are merged.
  const merged = new Map<string, Map<number, string>>();
  for (const message of reads) {
    const tool = message.tool!;
    const parsed = parseReadFileContent(readPaths(tool.input), tool.content!);
    for (const source of parsed) {
      const lines = merged.get(source.path) ?? new Map<number, string>();
      for (const line of source.lines) {
        lines.set(line.number, line.text);
      }
      merged.set(source.path, lines);
    }
  }
  const sources: CodeSource[] = [];
  for (const [path, lines] of merged) {
    const list = [...lines.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([number, text]) => ({ number, text }));
    sources.push(createSource(path, list));
  }
  if (sourceCache.size >= SOURCE_CACHE_LIMIT) {
    const oldest = sourceCache.keys().next().value;
    if (oldest !== undefined) {
      sourceCache.delete(oldest);
    }
  }
  sourceCache.set(signature, sources);
  return sources;
}

export function describeCodeBlock(
  info: string,
  options?: CodeBlockOptions
): CodeBlockInfo {
  const tokens = info.trim().split(/\s+/).filter((token) => token.length > 0);
  for (const token of tokens) {
    // A known language is never a file.
    if (supportsLanguage(token)) {
      continue;
    }
    const file = fileFromToken(token);
    if (file) {
      return {
        title: baseName(file.path) + (file.line > 0 ? ':' + file.line : ''),
        language: languageOf(file.path),
        file: file.path,
        line: file.line
      };
    }
  }
  // The model did not name the file, the text of the snippet finds it.
  const match =
    options?.content !== undefined && options.sources !== undefined
      ? matchSource(options.content, options.sources)
      : undefined;
  if (match) {
    return {
      title: baseName(match.path) + ':' + match.line,
      language: languageOf(match.path),
      file: match.path,
      line: match.line
    };
  }
  const language = (tokens[0] ?? '').toLowerCase();
  if (language.length > 0) {
    return {
      title: language,
      language,
      file: '',
      line: 0
    };
  }
  // The header of a block must not be empty: without a name the reader
  // does not know what the block is. The name of the command is better
  // when the block quotes its output, the word "Output" is the last
  // resort.
  return {
    title: commandTitle(options?.command, options?.content),
    language: 'text',
    file: '',
    line: 0
  };
}

// The name of the command, when the block quotes its output. The text of
// the block has to be a part of the output, otherwise the name belongs
// to another command.
function commandTitle(
  command: CommandHint | undefined,
  content: string | undefined
): string {
  if (command && quotesOutput(command.output, content)) {
    return command.command;
  }
  return STRINGS.codeOutput;
}

function quotesOutput(output: string, content: string | undefined): boolean {
  const text = (content ?? '').trim();
  if (text.length === 0) {
    return false;
  }
  return output.includes(text);
}
