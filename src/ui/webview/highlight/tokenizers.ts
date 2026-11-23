import type { CodeSpec } from './languages';
import type { Token, TokenKind } from './tokens';
import {
  isDigit,
  isIdentPart,
  isIdentStart,
  isUpperStart,
  isWordChar,
  OPERATORS,
  push,
  scanNumber,
  scanString,
  skipSpace
} from './helpers';

// The tokenizers of the languages: every language reads its code its way.
export function tokenizeCode(codeText: string, spec: CodeSpec): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);

    let matched = false;
    for (const [open, close] of spec.blockComments) {
      if (codeText.startsWith(open, i)) {
        const end = codeText.indexOf(close, i + open.length);
        const stop = end === -1 ? codeText.length : end + close.length;
        push(tokens, 'comment', codeText.slice(i, stop));
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    for (const marker of spec.lineComments) {
      if (codeText.startsWith(marker, i)) {
        const end = codeText.indexOf('\n', i);
        const stop = end === -1 ? codeText.length : end;
        push(tokens, 'comment', codeText.slice(i, stop));
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    for (const quote of spec.tripleStrings) {
      if (codeText.startsWith(quote, i)) {
        const end = codeText.indexOf(quote, i + quote.length);
        const stop = end === -1 ? codeText.length : end + quote.length;
        push(tokens, 'string', codeText.slice(i, stop));
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    if (spec.strings.includes(ch)) {
      const stop = scanString(codeText, i, ch);
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      continue;
    }

    const previous = i > 0 ? codeText.charAt(i - 1) : '';
    if (isDigit(ch) && !isWordChar(previous)) {
      const stop = scanNumber(codeText, i);
      push(tokens, 'number', codeText.slice(i, stop));
      i = stop;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i;
      while (j < codeText.length && isIdentPart(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const after = skipSpace(codeText, j);
      let kind: TokenKind = 'plain';
      if (spec.keywords.has(word.toLowerCase())) {
        kind = 'keyword';
      } else if (spec.types.has(word) || isUpperStart(word)) {
        kind = 'type';
      } else if (codeText.charAt(after) === '(') {
        kind = 'function';
      } else if (previous === '.') {
        kind = 'property';
      }
      push(tokens, kind, word);
      i = j;
      continue;
    }

    if (OPERATORS.includes(ch)) {
      push(tokens, 'operator', ch);
      i += 1;
      continue;
    }

    push(tokens, 'plain', ch);
    i += 1;
  }
  return tokens;
}

export function tokenizeMarkup(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < codeText.length) {
    if (codeText.startsWith('<!--', i)) {
      const end = codeText.indexOf('-->', i);
      const stop = end === -1 ? codeText.length : end + 3;
      push(tokens, 'comment', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (codeText.charAt(i) === '<') {
      let j = i + 1;
      push(tokens, 'tag', '<');
      if (codeText.charAt(j) === '/') {
        push(tokens, 'tag', '/');
        j += 1;
      }
      let k = j;
      while (k < codeText.length && /[A-Za-z0-9:_-]/.test(codeText.charAt(k))) {
        k += 1;
      }
      push(tokens, 'tag', codeText.slice(j, k));
      j = k;
      while (j < codeText.length && codeText.charAt(j) !== '>') {
        const c = codeText.charAt(j);
        if (/\s/.test(c)) {
          push(tokens, 'plain', c);
          j += 1;
          continue;
        }
        if (c === '=') {
          push(tokens, 'plain', c);
          j += 1;
          continue;
        }
        if (c === '"' || c === "'") {
          const stop = scanString(codeText, j, c);
          push(tokens, 'string', codeText.slice(j, stop));
          j = stop;
          continue;
        }
        let m = j;
        while (m < codeText.length && /[A-Za-z0-9:_-]/.test(codeText.charAt(m))) {
          m += 1;
        }
        if (m === j) {
          push(tokens, 'plain', c);
          j += 1;
          continue;
        }
        push(tokens, 'attribute', codeText.slice(j, m));
        j = m;
      }
      if (j < codeText.length) {
        push(tokens, 'tag', '>');
        j += 1;
      }
      i = j;
      continue;
    }
    const next = codeText.indexOf('<', i);
    const stop = next === -1 ? codeText.length : next;
    push(tokens, 'plain', codeText.slice(i, stop));
    i = stop;
  }
  return tokens;
}

export function tokenizeJson(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '"') {
      const stop = scanString(codeText, i, ch);
      const after = skipSpace(codeText, stop);
      const kind: TokenKind = codeText.charAt(after) === ':' ? 'attribute' : 'string';
      push(tokens, kind, codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (isDigit(ch) || (ch === '-' && isDigit(codeText.charAt(i + 1)))) {
      const stop = scanNumber(codeText, i);
      push(tokens, 'number', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < codeText.length && /[A-Za-z0-9_]/.test(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const lower = word.toLowerCase();
      const kind: TokenKind =
        lower === 'true' || lower === 'false' || lower === 'null' ? 'keyword' : 'plain';
      push(tokens, kind, word);
      i = j;
      continue;
    }
    push(tokens, 'plain', ch);
    i += 1;
  }
  return tokens;
}
