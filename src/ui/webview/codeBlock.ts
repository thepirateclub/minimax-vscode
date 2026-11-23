import type { CommandHint } from './commandHistory';
import { supportsLanguage } from './highlight';
import { matchSource, type CodeSource } from './codeSources';

// The source of a snippet lives in a module of its own, the readers of this
// module keep their imports.
export type { CodeMatch, CodeSource } from './codeSources';
export { collectFileSources, matchSource, parseReadFileContent } from './codeSources';
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

export interface CodeBlockOptions {
  // The text of the snippet.
  content?: string;
  // The files the agent has read.
  sources?: CodeSource[];
  // The command that ran before the block, the header can take its name.
  command?: CommandHint;
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
// The cache of the parsed reads, the panel renders the same text again and
// again while the answer grows.

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
