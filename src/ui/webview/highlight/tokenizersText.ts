import type { Token } from './tokens';
import {
  isDigit,
  push,
  scanNumber,
  scanString,
  skipSpace
} from './helpers';

// The tokenizers of the languages that read the text: the styles, the yaml,
// the markdown and the diff.
export function tokenizeCss(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let inBlock = false;
  let expectProperty = false;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (codeText.startsWith('/*', i)) {
      const end = codeText.indexOf('*/', i + 2);
      const stop = end === -1 ? codeText.length : end + 2;
      push(tokens, 'comment', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const stop = scanString(codeText, i, ch);
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '@') {
      let j = i + 1;
      while (j < codeText.length && /[A-Za-z-]/.test(codeText.charAt(j))) {
        j += 1;
      }
      push(tokens, 'keyword', codeText.slice(i, j));
      i = j;
      continue;
    }
    if (ch === '{') {
      inBlock = true;
      expectProperty = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === '}') {
      inBlock = false;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === ':' && inBlock) {
      expectProperty = false;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === ';') {
      expectProperty = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (isDigit(ch)) {
      const stop = scanNumber(codeText, i);
      push(tokens, 'number', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i;
      while (j < codeText.length && /[A-Za-z0-9_-]/.test(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const after = skipSpace(codeText, j);
      if (inBlock && expectProperty) {
        push(tokens, 'property', word);
      } else if (codeText.charAt(after) === '(') {
        push(tokens, 'function', word);
      } else {
        push(tokens, 'plain', word);
      }
      i = j;
      continue;
    }
    push(tokens, 'plain', ch);
    i += 1;
  }
  return tokens;
}

export function tokenizeYaml(codeText: string): Token[] {
  const tokens: Token[] = [];
  const literals = ['true', 'false', 'null', 'yes', 'no', 'on', 'off'];
  let i = 0;
  let atLineStart = true;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '\n') {
      atLineStart = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === '#') {
      const end = codeText.indexOf('\n', i);
      const stop = end === -1 ? codeText.length : end;
      push(tokens, 'comment', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const stop = scanString(codeText, i, ch);
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      atLineStart = false;
      continue;
    }
    if (atLineStart && (ch === '-' || ch === '?')) {
      push(tokens, 'operator', ch);
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9_.\-/]/.test(ch)) {
      let j = i;
      while (j < codeText.length && /[A-Za-z0-9_.\-/]/.test(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const after = skipSpace(codeText, j);
      if (codeText.charAt(after) === ':' || codeText.charAt(after) === '=') {
        push(tokens, 'attribute', word);
      } else if (/^[0-9.]+$/.test(word)) {
        push(tokens, 'number', word);
      } else if (literals.includes(word.toLowerCase())) {
        push(tokens, 'keyword', word);
      } else {
        push(tokens, 'plain', word);
      }
      i = j;
      atLineStart = false;
      continue;
    }
    push(tokens, 'plain', ch);
    i += 1;
    atLineStart = false;
  }
  return tokens;
}

export function tokenizeMarkdown(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let atLineStart = true;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '\n') {
      atLineStart = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (atLineStart && ch === '#') {
      let j = i;
      while (j < codeText.length && codeText.charAt(j) === '#') {
        j += 1;
      }
      push(tokens, 'keyword', codeText.slice(i, j));
      i = j;
      atLineStart = false;
      continue;
    }
    if (atLineStart && codeText.startsWith('```', i)) {
      const end = codeText.indexOf('\n', i);
      const stop = end === -1 ? codeText.length : end;
      push(tokens, 'operator', codeText.slice(i, stop));
      i = stop;
      atLineStart = false;
      continue;
    }
    if (ch === '`') {
      const end = codeText.indexOf('`', i + 1);
      const stop = end === -1 ? codeText.length : end + 1;
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      atLineStart = false;
      continue;
    }
    if (ch === '[') {
      const close = codeText.indexOf(']', i);
      if (close !== -1 && codeText.charAt(close + 1) === '(') {
        const urlEnd = codeText.indexOf(')', close + 2);
        const stop = urlEnd === -1 ? codeText.length : urlEnd + 1;
        push(tokens, 'variable', codeText.slice(i, close + 1));
        push(tokens, 'string', codeText.slice(close + 1, stop));
        i = stop;
        atLineStart = false;
        continue;
      }
    }
    push(tokens, 'plain', ch);
    i += 1;
    atLineStart = false;
  }
  return tokens;
}

export function tokenizeDiff(codeText: string): Token[] {
  const tokens: Token[] = [];
  const lines = codeText.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (index > 0) {
      push(tokens, 'plain', '\n');
    }
    if (line.startsWith('@@')) {
      push(tokens, 'comment', line);
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      push(tokens, 'type', line);
    } else if (line.startsWith('+')) {
      push(tokens, 'add', line);
    } else if (line.startsWith('-')) {
      push(tokens, 'remove', line);
    } else {
      push(tokens, 'plain', line);
    }
  }
  return tokens;
}
