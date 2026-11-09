export interface Passage {
  path: string;
  line: number;
  text: string;
}

// The file is cut into passages, the neighbours of a passage share a part of
// the text, so a sentence that crosses a border is still found.
export function chunkContent(
  path: string,
  content: string,
  options: { size?: number; overlap?: number } = {}
): Passage[] {
  const size = Math.max(1, options.size ?? 1200);
  const overlap = Math.max(0, Math.min(size - 1, options.overlap ?? 200));
  const step = Math.max(1, size - overlap);
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      starts.push(i + 1);
    }
  }
  const lineOf = (offset: number): number => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle]! <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
  const passages: Passage[] = [];
  for (let start = 0; start < content.length; start += step) {
    const end = Math.min(content.length, start + size);
    const text = content.slice(start, end).trim();
    if (text.length > 0) {
      passages.push({ path, line: lineOf(start), text });
    }
    if (end >= content.length) {
      break;
    }
  }
  return passages;
}

// The closeness of two vectors, from minus one to one.
export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!;
    const b = right[i]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

// The lists of the paths are merged into one list, a path that is high in
// several lists wins. The formula is the reciprocal rank fusion.
export function fuseRankings(rankings: string[][], k = 60): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((path, index) => {
      scores.set(path, (scores.get(path) ?? 0) + 1 / (k + index + 1));
    });
  }
  return [...scores.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([path]) => path);
}
