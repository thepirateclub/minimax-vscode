import type { UiMessage } from '../protocol';

// The files the agent has read, the snippets of them the panel shows and
// the search of a snippet inside a file. The block of the answer only asks
// this module for the name of the file of the code.
export interface CodeSource {
  path: string;
  lines: Array<{ number: number; text: string }>;
  // The trimmed text of a line points to its places in the file.
  positions: Map<string, number[]>;
}

export interface CodeMatch {
  path: string;
  line: number;
}

// The window of lines that has to match, more lines mean a certain match.
const MATCH_LINES = 5;
// The cache of the parsed reads, the panel renders the same text again and
// again while the answer grows.
const SOURCE_CACHE_LIMIT = 16;

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
