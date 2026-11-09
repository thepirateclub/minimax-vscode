import type { UiDiffLine } from '../protocol';

export interface DiffStats {
  added: number;
  removed: number;
}

// The header of a card shows the size of the change. The count comes from the
// same lines the diff draws, so the numbers and the picture cannot disagree.
export function diffStats(lines: UiDiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === 'add') {
      added += 1;
    } else if (line.type === 'remove') {
      removed += 1;
    }
  }
  return { added, removed };
}
