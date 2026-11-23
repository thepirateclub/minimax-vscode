import { tokenize } from '../tokenize';
import { MAX_LINES_PER_FILE, MAX_SCANNED_LINES, SNIPPET_LIMIT } from './protocol';

// The lines of the file that hold the words of the query, the best ones
// first. The function is pure: it takes the text of the file and gives the
// lines with their score.
export function bestLinesOf(
  content: string,
  query: string
): Array<{ line: number; snippet: string }> {
  const lines = content.split('\n');
  const lowerQuery = query.toLowerCase();
  const words = [...new Set(tokenize(query))];
  const scored: Array<{ line: number; snippet: string; score: number }> = [];
  const limit = Math.min(lines.length, MAX_SCANNED_LINES);
  for (let i = 0; i < limit; i++) {
    const text = lines[i]!;
    if (text.trim().length === 0) {
      continue;
    }
    const lower = text.toLowerCase();
    let score = 0;
    if (lower.includes(lowerQuery)) {
      score += 100;
    }
    for (const word of words) {
      if (lower.includes(word)) {
        score += 10;
      }
    }
    if (score > 0) {
      scored.push({ line: i + 1, snippet: text.trim().slice(0, SNIPPET_LIMIT), score });
    }
  }
  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, MAX_LINES_PER_FILE);
}
