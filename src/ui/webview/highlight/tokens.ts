export type TokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'type'
  | 'function'
  | 'variable'
  | 'operator'
  | 'attribute'
  | 'property'
  | 'tag'
  | 'add'
  | 'remove'
  | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}
