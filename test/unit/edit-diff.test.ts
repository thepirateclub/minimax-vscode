import { describe, expect, it } from 'vitest';
import { editDiff } from '../../src/ui/webview/editDiff';
import type { UiToolCall } from '../../src/ui/protocol';

function tool(partial: Partial<UiToolCall>): UiToolCall {
  return { id: 'tool-1', name: 'edit_file', input: {}, ...partial };
}

describe('the diff of an old edit', () => {
  it('shows the replaced lines as removed and the new ones as added', () => {
    const lines = editDiff(
      tool({
        input: {
          path: 'src/app.ts',
          old_string: 'const a = 1;',
          new_string: 'const a = 2;'
        }
      })
    );
    expect(lines).toEqual([
      { type: 'remove', text: 'const a = 1;' },
      { type: 'add', text: 'const a = 2;' }
    ]);
  });

  it('splits a text of several lines', () => {
    const lines = editDiff(tool({ input: { old_string: 'a\nb\n', new_string: 'c' } }));
    expect(lines?.map((line) => line.text)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the arguments of a failed edit', () => {
    expect(
      editDiff(tool({ input: { old_string: 'a', new_string: 'b' }, isError: true }))
    ).toBeUndefined();
  });

  it('keeps the arguments of a mass replace', () => {
    expect(
      editDiff(tool({ input: { old_string: 'a', new_string: 'b', replace_all: true } }))
    ).toBeUndefined();
  });

  it('has nothing to say about another tool', () => {
    expect(editDiff(tool({ name: 'write_file', input: { content: 'a' } }))).toBeUndefined();
  });
});
