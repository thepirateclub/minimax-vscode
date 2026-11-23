import { readFile, stat } from 'node:fs/promises';

// The layer that turns the code of the project into numbers.
export interface SemanticProvider {
  embed(texts: string[], type: 'query' | 'db'): Promise<number[][]>;
}

export type SearchMode = 'auto' | 'lexical' | 'semantic' | 'hybrid';

export interface SearchHit {
  path: string;
  line: number;
  score: number;
  snippet: string;
}

export interface SearchOutcome {
  hits: SearchHit[];
  mode: 'lexical' | 'semantic' | 'hybrid';
  files: number;
  note?: string;
}

export const MAX_FILE_BYTES = 512 * 1024;
export const READ_BATCH = 16;
export const MAX_CANDIDATE_FILES = 40;
export const MAX_LINES_PER_FILE = 3;
export const MAX_SCANNED_LINES = 4000;
export const FUZZY_FILE_BUDGET = 400;
export const FUZZY_MIN_SCORE = 0.2;
export const SEMANTIC_MAX_CHUNKS = 400;
export const EMBED_BATCH = 16;
export const EMBED_DELAY_MS = 1200;
export const SNIPPET_LIMIT = 240;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readIfSmall(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      return undefined;
    }
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

export function signatureOf(content: string): string {
  return content.length + ':' + content.slice(0, 64) + ':' + content.slice(-64);
}

export interface VectorEntry {
  path: string;
  signature: string;
  vectors: number[][];
  lines: number[];
  texts: string[];
}
