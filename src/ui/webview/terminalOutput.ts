export type TerminalLineKind = 'command' | 'output' | 'error' | 'note';

export interface TerminalLine {
  kind: TerminalLineKind;
  text: string;
}

const FAILED = /^Command failed with exit code (\d+)/;
const STDERR = /^\[stderr\]\s?/;
const NOTE = /^\[(no output|output truncated)\]$/;

// The output of a command is a plain text. The panel marks the lines of a
// failure, so that the reason of it is read at a glance and the rest stays
// quiet.
export function parseTerminalOutput(command: string, content: string): TerminalLine[] {
  const lines: TerminalLine[] = [{ kind: 'command', text: command }];
  // The stderr comes after the stdout, the lines after it belong to it too.
  let failed = false;
  const rows = content.split('\n');
  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index] ?? '';
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.length === 0) {
      continue;
    }
    // The tool writes the wrapper of a failure as the first line of the
    // result. A line of the output that looks the same stays in the output.
    if (index === 0 && FAILED.test(line)) {
      failed = true;
      continue;
    }
    if (STDERR.test(line)) {
      failed = true;
      lines.push({ kind: 'error', text: line.replace(STDERR, '') });
      continue;
    }
    if (NOTE.test(line)) {
      lines.push({ kind: 'note', text: line });
      continue;
    }
    lines.push({ kind: failed ? 'error' : 'output', text: line });
  }
  return lines;
}
