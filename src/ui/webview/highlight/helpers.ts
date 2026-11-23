import type { Token, TokenKind } from './tokens';

// The helpers of the scanners, the tokenizers of the languages use them.
export function push(tokens: Token[], kind: TokenKind, text: string): void {
  if (text.length === 0) {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
    return;
  }
  tokens.push({ kind, text });
}

export function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

export function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

export function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

export function isUpperStart(word: string): boolean {
  const first = word.charAt(0);
  return first !== '' && first === first.toUpperCase() && first !== first.toLowerCase();
}

export function skipSpace(codeText: string, index: number): number {
  let i = index;
  while (i < codeText.length && (codeText[i] === ' ' || codeText[i] === '\t')) {
    i += 1;
  }
  return i;
}

// The index after the closing quote, an unclosed string ends with the line.
export function scanString(codeText: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    if (ch === '\n' && quote !== '`') {
      return i;
    }
    i += 1;
  }
  return codeText.length;
}

export function scanNumber(codeText: string, start: number): number {
  let i = start;
  // A number can carry a sign. The scan has to take it, otherwise the
  // caller stands on the sign and never moves forward: the lexer spins on
  // the same place and the webview freezes the window of the editor.
  if (codeText.charAt(i) === '-' || codeText.charAt(i) === '+') {
    i += 1;
  }
  const first = codeText.charAt(i);
  if (first === '0' && /[xXbBoO]/.test(codeText.charAt(i + 1))) {
    i += 2;
    while (i < codeText.length && /[0-9a-fA-F_]/.test(codeText.charAt(i))) {
      i += 1;
    }
    return i;
  }
  while (i < codeText.length && (isDigit(codeText.charAt(i)) || codeText.charAt(i) === '_')) {
    i += 1;
  }
  if (codeText.charAt(i) === '.' && isDigit(codeText.charAt(i + 1))) {
    i += 1;
    while (i < codeText.length && (isDigit(codeText.charAt(i)) || codeText.charAt(i) === '_')) {
      i += 1;
    }
  }
  if (codeText.charAt(i) === 'e' || codeText.charAt(i) === 'E') {
    let j = i + 1;
    if (codeText.charAt(j) === '+' || codeText.charAt(j) === '-') {
      j += 1;
    }
    if (isDigit(codeText.charAt(j))) {
      i = j;
      while (i < codeText.length && isDigit(codeText.charAt(i))) {
        i += 1;
      }
    }
  }
  // The scan always moves forward. A scanner that stands still turns the
  // lexer into an endless loop, and a frozen webview freezes the window of
  // the editor with it.
  return i > start ? i : start + 1;
}

export const OPERATORS = '+-*/%=<>!&|^~?:';
