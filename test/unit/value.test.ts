import { describe, expect, it } from 'vitest';
import { text, textOrEmpty } from '../../src/ui/webview/value';

describe('the value of an argument of a tool', () => {
  it('shows a string as it is', () => {
    expect(text('src/app.ts')).toBe('src/app.ts');
  });

  it('shows nothing when the argument is not given', () => {
    expect(text(undefined)).toBe('');
  });

  it('shows an object as a json, the reader needs the arguments', () => {
    expect(text({ path: 'src/app.ts' })).toBe('{"path":"src/app.ts"}');
  });

  it('shows a number as a json too', () => {
    expect(text(42)).toBe('42');
  });
});

describe('the value of a file', () => {
  it('shows a string as it is', () => {
    expect(textOrEmpty('src/app.ts')).toBe('src/app.ts');
  });

  it('shows nothing for anything else, a file is a string', () => {
    expect(textOrEmpty(undefined)).toBe('');
    expect(textOrEmpty({ path: 'src/app.ts' })).toBe('');
    expect(textOrEmpty(42)).toBe('');
  });
});
