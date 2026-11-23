import { describe, expect, it } from 'vitest';
import { cardOpen } from '../../src/ui/webview/toolCard';

// The card of an action follows the setting. The card must open again when
// the setting is turned off, and it must stay folded while the setting is on.
describe('the state of the card of an action', () => {
  it('folds the card when the setting asks for it', () => {
    expect(cardOpen(true, false, null)).toBe(false);
  });

  it('opens the card when the setting is off', () => {
    expect(cardOpen(false, false, null)).toBe(true);
  });

  it('keeps a long output folded even without the setting', () => {
    expect(cardOpen(false, true, null)).toBe(false);
  });

  it('lets the reader open and fold the card by hand', () => {
    expect(cardOpen(true, false, true)).toBe(true);
    expect(cardOpen(false, false, false)).toBe(false);
  });
});
