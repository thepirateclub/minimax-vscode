import type { TerminalLine } from './terminalOutput';

// The result of a block of the REPL as the lines of the terminal of the
// card: the output stays quiet, the lines of stderr carry the chip of the
// stream, the error of the block and its trace are red. The tool writes the
// error after the mark `[error] ` (src/tools/repl/processes.ts).
const ERROR = /^\[error\]\s?/;
const STDERR = /^\[stderr\]\s?/;
const NOTE = /^\[(no output|output truncated.*)\]$/;

export function parseReplOutput(content: string): TerminalLine[] {
  const lines: TerminalLine[] = [];
  let failed = false;
  for (const raw of content.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!failed && ERROR.test(line)) {
      failed = true;
      const text = line.replace(ERROR, '');
      if (text.length > 0) {
        lines.push({ kind: 'error', text });
      }
      continue;
    }
    if (failed) {
      lines.push({ kind: 'error', text: line });
    } else if (STDERR.test(line)) {
      lines.push({ kind: 'output', text: line.replace(STDERR, ''), stream: 'stderr' });
    } else if (NOTE.test(line)) {
      lines.push({ kind: 'note', text: line.slice(1, -1) });
    } else {
      lines.push({ kind: 'output', text: line });
    }
  }
  // The trace ends with an empty line, the card does not draw it.
  while (lines.length > 0 && lines[lines.length - 1]!.text.length === 0) {
    lines.pop();
  }
  return lines;
}

// The language of the highlight of the code of the block.
export function replLanguage(toolName: string): string {
  return toolName === 'repl_python' ? 'python' : 'javascript';
}
