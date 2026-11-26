import { describe, expect, it } from 'vitest';
import { approvalKey, type KeyFocus } from '../../src/ui/webview/approvalKeys';

const key = (name: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean }> = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...extra
});
const away: KeyFocus = { editing: false, emptyField: true, inCard: false };
const typing: KeyFocus = { editing: true, emptyField: false, inCard: false };
const emptyField: KeyFocus = { editing: true, emptyField: true, inCard: false };
const card = { strict: false, canAlways: true };
const strict = { strict: true, canAlways: false };

describe('the keys of the approval card', () => {
  it('allows, allows always and rejects when the reader is not typing', () => {
    expect(approvalKey(key('Enter'), away, card)).toBe('approve');
    expect(approvalKey(key('a'), away, card)).toBe('always');
    expect(approvalKey(key('Escape'), away, card)).toBe('reject');
  });

  it('leaves the keys to the field with text', () => {
    expect(approvalKey(key('Enter'), typing, card)).toBeUndefined();
    expect(approvalKey(key('Escape'), typing, card)).toBeUndefined();
  });

  it('takes Enter and Esc from an empty field, but never the letter', () => {
    expect(approvalKey(key('Enter'), emptyField, card)).toBe('approve');
    expect(approvalKey(key('a'), emptyField, card)).toBeUndefined();
  });

  it('needs the focus on the card for a tool that asks every time', () => {
    expect(approvalKey(key('Enter'), emptyField, strict)).toBeUndefined();
    expect(approvalKey(key('Enter'), { ...emptyField, inCard: true }, strict)).toBe('approve');
    expect(approvalKey(key('Enter'), away, strict)).toBeUndefined();
    expect(approvalKey(key('a'), { ...away, inCard: true }, strict)).toBeUndefined();
  });

  it('ignores the chords and Shift+Enter', () => {
    expect(approvalKey(key('Enter', { shiftKey: true }), away, card)).toBeUndefined();
    expect(approvalKey(key('Enter', { ctrlKey: true }), away, card)).toBeUndefined();
  });
});
