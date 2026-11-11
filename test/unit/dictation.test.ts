import { describe, expect, it } from 'vitest';
import { dictationPiece } from '../../src/ui/webview/dictation';

describe('the dictated text in the input field', () => {
  it('goes into an empty field as it is', () => {
    expect(dictationPiece('', 'rename the function')).toBe('rename the function');
  });

  it('is parted from the draft by one space', () => {
    expect(dictationPiece('look at', 'the tests')).toBe(' the tests');
  });

  it('adds no second space after a space or a new line', () => {
    expect(dictationPiece('look at ', 'the tests')).toBe('the tests');
    expect(dictationPiece('first line\n', 'second')).toBe('second');
  });

  it('drops the blanks around the transcript', () => {
    expect(dictationPiece('', '  hello  ')).toBe('hello');
  });
});
