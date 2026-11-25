import { describe, expect, it } from 'vitest';
import { extractSymbol, formatSymbols } from '../../src/tools/symbols';

const GAME = [
  'export class Game {',
  '  private emit(): void {',
  '    this.rebuildSnapshot()',
  "    const text = '}'",
  '    for (const listener of this.listeners) listener()',
  '  }',
  '',
  '  // Checks the achievements.',
  '  private checkAchievements(): void {',
  '    for (const a of ACHIEVEMENTS) {',
  '      if (a.done) { this.notify(`Done ${a.name}`) }',
  '    }',
  '  }',
  '',
  '  toggleMute = () => {',
  '    this.audio.toggleMute()',
  '  }',
  '}',
  'export const LIMIT = 10;',
  'if (emit(x)) {',
  '}'
].join('\n');

// The model takes the bodies it needs by their names, instead of cutting
// them into tmp files of the project and reading them again.
describe('the bodies of the symbols', () => {
  it('takes a method to its closing brace, a brace in a string does not close it', () => {
    expect(extractSymbol(GAME, 'emit', 'game.ts')).toMatchObject({ start: 2, end: 6 });
  });

  it('takes the comment above and the nested braces', () => {
    const body = extractSymbol(GAME, 'checkAchievements', 'game.ts')!;
    expect(body.start).toBe(8);
    expect(body.end).toBe(13);
  });

  it('takes an arrow property, a class and a one-line constant', () => {
    expect(extractSymbol(GAME, 'toggleMute', 'game.ts')).toMatchObject({ start: 15, end: 17 });
    expect(extractSymbol(GAME, 'Game', 'game.ts')).toMatchObject({ start: 1, end: 18 });
    expect(extractSymbol(GAME, 'LIMIT', 'game.ts')).toMatchObject({ start: 19, end: 19 });
  });

  it('takes a Python function by its indent', () => {
    const code = 'class A:\n    @property\n    def value(self):\n        if x:\n            return 1\n\n        return 2\n\n    def other(self):\n        pass';
    expect(extractSymbol(code, 'value', 'a.py')).toMatchObject({ start: 2, end: 7 });
  });

  it('gives several bodies in one answer with numbered lines and names the missing', () => {
    const text = formatSymbols('src/game.ts', GAME, ['emit', 'nope', 'LIMIT']);
    expect(text).toContain('=== emit (src/game.ts:2-6) ===\n2:   private emit(): void {');
    expect(text).toContain('=== LIMIT (src/game.ts:19-19) ===\n19: export const LIMIT = 10;');
    expect(text).toContain('Not found in src/game.ts: nope.');
  });
});
