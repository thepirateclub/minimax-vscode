// The journal of a long action keeps its tail: the live output of a build
// that runs for an hour must not grow the chat without end. The host and
// the panel cut it by the same rule.
export const MAX_PROGRESS = 400;

export function keepRecent(lines: string[]): string[] {
  return lines.length > MAX_PROGRESS ? lines.slice(-MAX_PROGRESS) : lines;
}
