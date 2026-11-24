
// The preview of a folded section of the chat: one line that says what the
// section holds, so the reader knows what he opens before he opens it.

// How many words of the reasoning the preview takes. The reasoning is a long
// text, the preview is one line of the chat.
export const PREVIEW_WORDS = 50;
// The bound of the characters of the preview: a long word is cut earlier
// than the bound of the words, the line has to fit the panel of the editor.
export const PREVIEW_CHARS = 240;

// The preview of the reasoning: the first words of it in one line, with the
// ellipsis when the text did not fit.
export function thinkingPreview(text: string): string {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
  const kept: string[] = [];
  let length = 0;
  for (const word of words) {
    if (kept.length >= PREVIEW_WORDS) {
      break;
    }
    const next = length + (kept.length > 0 ? 1 : 0) + word.length;
    if (next > PREVIEW_CHARS) {
      break;
    }
    kept.push(word);
    length = next;
  }
  const cut = kept.length < words.length;
  return kept.join(' ') + (cut ? '…' : '');
}
