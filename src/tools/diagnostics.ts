// The problems of a file after a change: the errors and the warnings of the
// language servers of the editor. The model reads them in the result of the
// write and fixes what it broke in the same turn, a check of the edit is the
// feedback with a measured effect on the quality of the code (SWE-agent).
// The tool layer does not know the editor: the host passes the provider.

export interface Problem {
  // The line of the problem, counted from 1.
  line: number;
  severity: 'error' | 'warning';
  message: string;
  // The tool that reported it, for example ts or eslint.
  source?: string;
}

// The host reads the problems of one file, the path is absolute.
export type DiagnosticsProvider = (path: string, signal: AbortSignal) => Promise<Problem[]>;

const MAX_PROBLEMS = 20;

// The diagnostic as the editor gives it: the severity of vscode (0 error,
// 1 warning, 2 information, 3 hint) and the line counted from 0.
export interface RawDiagnostic {
  severity: number;
  line: number;
  message: string;
  source?: string;
}

// The part of the editor the provider needs, the host adapts vscode to it.
export interface DiagnosticsEditor {
  // Opens the document without showing it, the language server starts on it.
  open(path: string): Promise<void>;
  read(path: string): RawDiagnostic[];
  // Calls back with the paths whose diagnostics changed, returns the dispose.
  onChange(listener: (paths: string[]) => void): () => void;
}

// The problems of a file after a write: the provider waits for a fresh
// report of the language server. A report that does not come in time gives
// nothing, the old one would show the errors of the file before the change.
export function createDiagnosticsProvider(
  editor: DiagnosticsEditor,
  timeoutMs: number
): DiagnosticsProvider {
  return async (path, signal) => {
    let dispose: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const fresh = await new Promise<boolean>((resolve) => {
        // The listener goes first: opening the file may report at once.
        dispose = editor.onChange((paths) => {
          if (paths.some((changed) => samePath(changed, path))) {
            resolve(true);
          }
        });
        timer = setTimeout(() => resolve(false), timeoutMs);
        onAbort = () => resolve(false);
        signal.addEventListener('abort', onAbort);
        if (signal.aborted) {
          resolve(false);
          return;
        }
        editor.open(path).catch(() => resolve(false));
      });
      return fresh ? toProblems(editor.read(path)) : [];
    } finally {
      dispose?.();
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  };
}

// The errors and the warnings, the information and the hints are noise.
function toProblems(items: readonly RawDiagnostic[]): Problem[] {
  const problems: Problem[] = [];
  for (const item of items) {
    if (item.severity !== 0 && item.severity !== 1) {
      continue;
    }
    const problem: Problem = {
      line: item.line + 1,
      severity: item.severity === 0 ? 'error' : 'warning',
      message: item.message
    };
    if (item.source) {
      problem.source = item.source;
    }
    problems.push(problem);
  }
  return problems;
}

// The paths of Windows do not care about the case of the letters.
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function formatProblems(problems: readonly Problem[]): string {
  if (problems.length === 0) {
    return '';
  }
  const sorted = [...problems].sort(
    (a, b) => rank(a) - rank(b) || a.line - b.line
  );
  const errors = problems.filter((problem) => problem.severity === 'error').length;
  const warnings = problems.length - errors;
  const head =
    'Problems in the file after the change, ' +
    count(errors, 'error') +
    ', ' +
    count(warnings, 'warning') +
    '. Fix the errors your change caused before you go on:';
  const lines = sorted.slice(0, MAX_PROBLEMS).map(
    (problem) =>
      '- line ' +
      problem.line +
      ' ' +
      problem.severity +
      ': ' +
      problem.message.replace(/\s+/g, ' ').trim() +
      (problem.source ? ' [' + problem.source + ']' : '')
  );
  const left = sorted.length - MAX_PROBLEMS;
  if (left > 0) {
    lines.push('... and ' + left + ' more');
  }
  return [head, ...lines].join('\n');
}

// The result of a write with the problems of the file under it. A provider
// that fails says nothing: the write itself went through.
export async function withProblems(
  result: string,
  path: string,
  provider: DiagnosticsProvider | undefined,
  signal: AbortSignal
): Promise<string> {
  if (!provider) {
    return result;
  }
  try {
    const text = formatProblems(await provider(path, signal));
    return text.length > 0 ? result + '\n' + text : result;
  } catch {
    return result;
  }
}

function rank(problem: Problem): number {
  return problem.severity === 'error' ? 0 : 1;
}

function count(value: number, word: string): string {
  return value + ' ' + word + (value === 1 ? '' : 's');
}
