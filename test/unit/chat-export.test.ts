import { describe, expect, it } from 'vitest';
import { chatToMarkdown, exportFileName, fenceFor, toolLine } from '../../src/ui/chatExport';
import type { UiMessage } from '../../src/ui/protocol';

const chat = (uiMessages: UiMessage[]) => ({ title: 'Fix bug', updatedAt: 0, uiMessages });

describe('chat export', () => {
  it('writes the title, the user and the answer', () => {
    const md = chatToMarkdown(
      chat([
        { id: '1', role: 'user', text: 'Hello' },
        { id: '2', role: 'assistant', text: 'Hi there', thinking: 'the user greets' }
      ])
    );
    expect(md.startsWith('# Fix bug\n')).toBe(true);
    expect(md).toContain('## User\n\nHello');
    expect(md).toContain('## Assistant');
    expect(md).toContain('<details>\n<summary>Thinking</summary>\n\nthe user greets\n\n</details>');
    expect(md.indexOf('<details>')).toBeLessThan(md.indexOf('Hi there'));
  });

  it('writes an action in the words of its card, not the raw name', () => {
    const line = toolLine({ id: 't', name: 'read_file', input: { path: 'src/a.ts' }, content: 'x' });
    expect(line).toContain('src/a.ts');
    expect(line).not.toContain('read_file');
    expect(line.startsWith('- ✓ ')).toBe(true);
    expect(toolLine({ id: 't', name: 'read_file', input: { path: 'a' }, isError: true }).startsWith('- ✗ ')).toBe(true);
  });

  it('puts actions in a row into one list and a diff into a diff block', () => {
    const md = chatToMarkdown(
      chat([
        { id: '1', role: 'tool', tool: { id: 'a', name: 'read_file', input: { path: 'a.ts' } } },
        {
          id: '2',
          role: 'tool',
          tool: {
            id: 'b',
            name: 'edit_file',
            input: { path: 'a.ts' },
            diff: { path: 'a.ts', lines: [{ type: 'remove', text: 'old' }, { type: 'add', text: 'new' }, { type: 'context', text: 'same' }] }
          }
        }
      ])
    );
    expect(md).toMatch(/- ✓ [^\n]+\n- ✓ /);
    expect(md).toContain('```diff\n-old\n+new\n same\n```');
  });

  it('skips approval cards and quotes notices', () => {
    const md = chatToMarkdown(
      chat([
        { id: '1', role: 'tool', tool: { id: 'a', name: 'write_file', input: {} }, approval: { id: 'x' } as never },
        { id: '2', role: 'notice', text: 'Stopped\nby the user' }
      ])
    );
    expect(md).not.toContain('write');
    expect(md).toContain('> Stopped\n> by the user');
  });

  it('uses a fence longer than the backticks of the text', () => {
    expect(fenceFor('plain')).toBe('```');
    expect(fenceFor('a ```` b')).toBe('`````');
  });

  it('makes a safe file name', () => {
    expect(exportFileName('a/b: c?')).toBe('a b c.md');
    expect(exportFileName('  ')).toBe('chat.md');
  });
});
