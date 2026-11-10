import { describe, expect, it } from 'vitest';
import { parseReadFileContent } from '../../src/ui/webview/codeBlock';
import { renderMarkdown } from '../../src/ui/webview/markdown';

describe('renderMarkdown', () => {
  it('renders a heading', () => {
    expect(renderMarkdown('## Plan')).toContain('<h2>Plan</h2>');
  });

  it('renders a code block with the language and a copy button', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('class="code-lang">ts<');
    expect(html).toContain('class="code-copy"');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html.replace(/<[^>]+>/g, '')).toContain('const a = 1;');
  });

  it('names a code block that comes from a file', () => {
    const html = renderMarkdown('```src/api/history.ts\nexport const a = 1;\n```');
    expect(html).toContain('class="code-lang code-file"');
    expect(html).toContain('data-path="src/api/history.ts"');
    expect(html).toContain('history.ts');
    expect(html).toContain('<span class="tok-keyword">export</span>');
  });

  it('names a code block by the file the agent has read', () => {
    const sources = parseReadFileContent(['src/api/history.ts'], '1: export const a = 1;');
    const html = renderMarkdown('```ts\nexport const a = 1;\n```', sources);
    expect(html).toContain('class="code-lang code-file"');
    expect(html).toContain('data-path="src/api/history.ts"');
    expect(html).toContain('data-line="1"');
    expect(html).toContain('history.ts:1');
  });

  it('names a block without a name', () => {
    const html = renderMarkdown('```\n8: hp: 58, atk: 13\n```');
    // The header of a block must not be empty.
    expect(html).toContain('class="code-lang">Output<');
  });

  it('names a block by the command it quotes', () => {
    const html = renderMarkdown('```\nall tests passed\n```', [], {
      collapseCode: false,
      command: { command: 'npm test', output: 'all tests passed\n' }
    });
    expect(html).toContain('npm test');
  });

  it('keeps the word Output when the block quotes another command', () => {
    const html = renderMarkdown('```\nsomething else\n```', [], {
      collapseCode: false,
      command: { command: 'npm test', output: 'all tests passed\n' }
    });
    expect(html).toContain('class="code-lang">Output<');
  });

  it('keeps the name of the command apart in the cache', () => {
    const text = '```\nall tests passed\n```';
    const plain = renderMarkdown(text);
    const named = renderMarkdown(text, [], {
      collapseCode: false,
      command: { command: 'npm test', output: 'all tests passed\n' }
    });
    expect(plain).not.toBe(named);
  });

  it('renders a checklist item with a box', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('task-item');
    expect(html.match(/task-check/g)).toHaveLength(2);
    expect(html).toContain('checked');
  });

  it('drops the brackets of a checklist item, the box replaces them', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).not.toContain('[x]');
    expect(html).not.toContain('[ ]');
    expect(html).toContain('> done');
  });

  it('marks the list of a checklist, the boxes stand on the left edge', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('<ul class="task-list">');
    expect(renderMarkdown('- one')).not.toContain('task-list');
  });

  it('keeps a plain list item clean', () => {
    const html = renderMarkdown('- one\n- two');
    expect(html).not.toContain('task-check');
  });

  it('escapes raw html', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
  });

  it('renders a table', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });

  it('gives the same html for the same text', () => {
    const text = 'the same **text**';
    expect(renderMarkdown(text)).toBe(renderMarkdown(text));
  });

  it('collapses a code block when the setting asks for it', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```', [], { collapseCode: true });
    expect(html).toContain('class="code-block collapsed"');
    expect(html).toContain('class="code-toggle"');
  });

  it('keeps a code block open when the setting is off', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    expect(html).toContain('class="code-block"');
    expect(html).not.toContain('code-toggle');
  });

  it('keeps the open and the collapsed block apart in the cache', () => {
    const text = '```ts\nconst a = 1;\n```';
    const open = renderMarkdown(text);
    const closed = renderMarkdown(text, [], { collapseCode: true });
    expect(open).not.toBe(closed);
    expect(open).not.toContain('collapsed');
    expect(closed).toContain('collapsed');
  });
});
