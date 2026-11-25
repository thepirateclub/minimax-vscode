import { readFile } from 'node:fs/promises';
import { resolveWorkspacePath } from '../paths';
import { diffLines, type DiffLine } from './diff';
import { extractSymbol } from './symbols';
import type { ToolEntry } from './types';

// The model compared two files by reading both and looking for the
// difference itself, or by writing a script into the REPL: the comparison is
// a tool now, the answer is a unified diff with the numbers of the lines.

const MAX_DIFF_LINES = 400;

// The unified diff of the lines: a hunk head at every jump of the numbers.
export function formatUnified(lines: DiffLine[], labelA: string, labelB: string): string {
  if (lines.every((line) => line.type === 'context')) {
    return 'No difference: ' + labelA + ' and ' + labelB + ' are identical.';
  }
  const added = lines.filter((line) => line.type === 'add').length;
  const removed = lines.filter((line) => line.type === 'remove').length;
  const out = ['--- ' + labelA, '+++ ' + labelB];
  let lastOld: number | undefined;
  let lastNew: number | undefined;
  for (const line of lines.slice(0, MAX_DIFF_LINES)) {
    const jump =
      (line.oldLine !== undefined && lastOld !== undefined && line.oldLine !== lastOld + 1) ||
      (line.newLine !== undefined && lastNew !== undefined && line.newLine !== lastNew + 1);
    if (out.length === 2 || jump) {
      out.push('@@ -' + (line.oldLine ?? lastOld ?? 0) + ' +' + (line.newLine ?? lastNew ?? 0) + ' @@');
    }
    out.push((line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ') + line.text);
    lastOld = line.oldLine ?? lastOld;
    lastNew = line.newLine ?? lastNew;
  }
  if (lines.length > MAX_DIFF_LINES) {
    out.push('... ' + (lines.length - MAX_DIFF_LINES) + ' more lines of the diff are cut');
  }
  out.push('', '+' + added + ' -' + removed);
  return out.join('\n');
}

async function readSide(
  root: string,
  path: unknown,
  text: unknown,
  name: string,
  symbol?: unknown
): Promise<{ label: string; text: string }> {
  if (typeof path === 'string' && path.trim().length > 0) {
    const full = resolveWorkspacePath(root, path.trim());
    const content = (await readFile(full, 'utf8')).replace(/\r\n/g, '\n');
    // A side may be one function of the file: the model compared the same
    // method of a web and of a native version by cutting both out by hand.
    if (typeof symbol === 'string' && symbol.trim().length > 0) {
      const body = extractSymbol(content, symbol.trim(), path.trim());
      if (!body) {
        throw new Error('no symbol ' + symbol.trim() + ' in ' + path.trim());
      }
      return { label: path.trim() + '#' + symbol.trim(), text: body.text };
    }
    return { label: path.trim(), text: content };
  }
  if (typeof text === 'string') {
    return { label: name, text: text.replace(/\r\n/g, '\n') };
  }
  throw new Error('Give ' + name + ' as a path or as a text.');
}

export function createCompareTools(): ToolEntry[] {
  const diffFiles: ToolEntry = {
    name: 'diff_files',
    description:
      'Show the difference of two files of the workspace as a unified diff with line numbers. Use it instead of reading both files to compare them, for example a file and its copy, two versions or two similar modules.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        path_a: { type: 'string', description: 'The first file, relative to the workspace root.' },
        path_b: { type: 'string', description: 'The second file, relative to the workspace root.' }
      },
      required: ['path_a', 'path_b']
    },
    async execute(input, ctx) {
      try {
        const a = await readSide(ctx.workspaceRoot, input['path_a'], undefined, 'path_a');
        const b = await readSide(ctx.workspaceRoot, input['path_b'], undefined, 'path_b');
        return { content: formatUnified(diffLines(a.text, b.text), a.label, b.label) };
      } catch (error) {
        return { content: 'diff_files failed: ' + (error as Error).message, isError: true };
      }
    }
  };

  const compare: ToolEntry = {
    name: 'compare',
    description:
      'Compare two texts as a unified diff: each side is a file of the workspace (path_a, path_b) or a text you pass (text_a, text_b). Use it to check a file against the text you expect, two outputs against each other, or the same function in two files: give symbol_a and symbol_b with the paths, for example a method of a web and of a native version.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        path_a: { type: 'string', description: 'The first side as a file of the workspace.' },
        text_a: { type: 'string', description: 'The first side as a text, when there is no path_a.' },
        path_b: { type: 'string', description: 'The second side as a file of the workspace.' },
        text_b: { type: 'string', description: 'The second side as a text, when there is no path_b.' },
        symbol_a: { type: 'string', description: 'Only this function, method or class of path_a.' },
        symbol_b: { type: 'string', description: 'Only this function, method or class of path_b.' }
      }
    },
    async execute(input, ctx) {
      try {
        const a = await readSide(ctx.workspaceRoot, input['path_a'], input['text_a'], 'text_a', input['symbol_a']);
        const b = await readSide(ctx.workspaceRoot, input['path_b'], input['text_b'], 'text_b', input['symbol_b']);
        return { content: formatUnified(diffLines(a.text, b.text), a.label, b.label) };
      } catch (error) {
        return { content: 'compare failed: ' + (error as Error).message, isError: true };
      }
    }
  };

  return [diffFiles, compare];
}
