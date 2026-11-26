import { describe, expect, it } from 'vitest';
import { applyEdit } from '../../src/tools/editMatch';

describe('applyEdit, the exact match', () => {
  it('replaces the one exact occurrence', () => {
    expect(applyEdit('a\nb\nc\n', 'b', 'B', false)).toEqual({ ok: true, text: 'a\nB\nc\n', lenient: false });
  });

  it('replaces every occurrence with replace_all, the dollars stay literal', () => {
    expect(applyEdit('x x', 'x', '$&y', true)).toEqual({ ok: true, text: '$&y $&y', lenient: false });
  });

  it('refuses several exact occurrences without replace_all', () => {
    const result = applyEdit('x\nx\n', 'x', 'y', false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('found 2 times');
  });

  it('refuses an empty old_string', () => {
    expect(applyEdit('a', '', 'b', false).ok).toBe(false);
  });
});

// The model often gets the indentation or the spaces at the end of a line
// wrong. Without a lenient match Aider saw nine times more failed edits.
describe('applyEdit, the lenient match', () => {
  it('matches the lines when only the indentation differs and keeps the indentation of the file', () => {
    const file = 'function f() {\n    if (a) {\n        run();\n    }\n}\n';
    const result = applyEdit(file, 'if (a) {\n    run();\n}', 'if (a) {\n    run();\n    log();\n}', false);
    expect(result).toEqual({
      ok: true,
      text: 'function f() {\n    if (a) {\n        run();\n        log();\n    }\n}\n',
      lenient: true
    });
  });

  it('moves only the first line when only the first line lost its indentation', () => {
    // The space at the end of the first line makes the exact match miss.
    const file = 'function f() {\n    if (a) { \n        run();\n    }\n}\n';
    const result = applyEdit(file, 'if (a) {\n        run();\n    }', 'if (b) {\n        run();\n    }', false);
    expect(result).toEqual({
      ok: true,
      text: 'function f() {\n    if (b) {\n        run();\n    }\n}\n',
      lenient: true
    });
  });

  it('ignores the spaces at the end of the lines', () => {
    const result = applyEdit('a  \nb\t\nc\n', 'a\nb', 'A\nB', false);
    expect(result).toEqual({ ok: true, text: 'A\nB\nc\n', lenient: true });
  });

  it('keeps the line endings of a windows file', () => {
    const result = applyEdit('one\r\n  two\r\nthree\r\n', 'two\nthree', 'two\n2.5\nthree', false);
    expect(result).toEqual({ ok: true, text: 'one\r\n  two\r\n  2.5\r\n  three\r\n', lenient: true });
  });

  it('refuses a lenient match that is not unique', () => {
    const result = applyEdit('  a\n  b\n    a\n    b\n', 'a\nb', 'x', false);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('2 places');
  });
});

describe('applyEdit, the miss', () => {
  it('names the closest text with its line numbers', () => {
    const file = 'const a = 1;\nconst b = 2;\nconst c = 3;\nexport { a, b, c };\n';
    const result = applyEdit(file, 'const b = 2;\nconst c = 4;', 'x', false);
    expect(result.ok).toBe(false);
    const error = !result.ok ? result.error : '';
    expect(error).toContain('old_string not found');
    expect(error).toContain('closest text, lines 2-3');
    expect(error).toContain('2: const b = 2;');
    expect(error).toContain('3: const c = 3;');
  });

  it('says that nothing is close when no line matches', () => {
    const result = applyEdit('alpha\nbeta\n', 'gamma', 'x', false);
    expect(!result.ok && result.error).toContain('read the file again');
  });
});
