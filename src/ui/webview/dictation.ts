// The dictated text goes after the draft of the field. A space parts them,
// unless the draft already ends with a blank or is empty.
export function dictationPiece(draft: string, spoken: string): string {
  const text = spoken.trim();
  if (draft.length === 0 || /\s$/.test(draft)) {
    return text;
  }
  return ' ' + text;
}
