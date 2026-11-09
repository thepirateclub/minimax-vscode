export interface ReadLine {
  // The number of the line in the file, zero when the line has no number.
  number: number;
  text: string;
}

export interface ReadBlock {
  path: string;
  lines: ReadLine[];
}

const SOURCE_HEADER = /^=== (.+) ===$/;
const NUMBERED_LINE = /^(\d+): ?(.*)$/;

// The result of read_file carries the number of the line in front of it. The
// panel takes the numbers back and shows the file as it is, a raw dump of the
// text looks like a broken tool.
export function parseReadOutput(content: string, fallbackPath: string): ReadBlock[] {
  const blocks: ReadBlock[] = [];
  let path = fallbackPath;
  let lines: ReadLine[] = [];

  const flush = (): void => {
    if (lines.length > 0) {
      blocks.push({ path, lines });
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
    if (numbered) {
      lines.push({ number: Number(numbered[1]), text: numbered[2] ?? '' });
      continue;
    }
    // An empty line between the files of a multi read is not a line of code.
    if (line.length === 0) {
      continue;
    }
    // A note of the tool, for example [empty file] or the text of a failure.
    lines.push({ number: 0, text: line });
  }
  flush();
  return blocks;
}
