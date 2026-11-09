// The words that carry no meaning for the search of the code.
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'not', 'but', 'are', 'was', 'were', 'has', 'have', 'had',
  'this', 'that', 'these', 'those', 'they', 'them', 'their', 'from', 'with', 'into',
  'than', 'then', 'when', 'while', 'where', 'which', 'who', 'what', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'can', 'will', 'should', 'now', 'there',
  'because', 'about', 'against', 'among', 'at', 'be', 'by', 'if', 'in', 'is', 'of',
  'on', 'or', 'to', 'we', 'us', 'you', 'your', 'he', 'she', 'his', 'her', 'it',
  'its', 'my', 'me', 'our', 'as', 'via', 'per', 'do', 'does', 'did'
]);

// A word of the code is split into its parts, the camel case and the digits
// are the borders of a part.
export function splitIdentifier(word: string): string[] {
  return word
    .split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])/)
    .filter((part) => part.length > 0);
}

// The words of the text, in the lower case. A word of the code keeps its
// whole form and its parts, so a search for "readFile" and a search for
// "read_file" find the same place.
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const words = text.match(/[A-Za-z0-9_]+/g) ?? [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length >= 2 && !STOP_WORDS.has(lower)) {
      tokens.push(lower);
    }
    const parts = word.split('_').flatMap((part) => splitIdentifier(part));
    if (parts.length > 1) {
      for (const part of parts) {
        // A pure number carries no word, the whole form of the identifier
        // keeps it anyway.
        if (/^\d+$/.test(part)) {
          continue;
        }
        const piece = part.toLowerCase();
        if (piece.length >= 2 && piece !== lower && !STOP_WORDS.has(piece)) {
          tokens.push(piece);
        }
      }
    }
  }
  return tokens;
}
