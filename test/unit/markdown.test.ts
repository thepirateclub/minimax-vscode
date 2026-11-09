import { describe, expect, it } from 'vitest';
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
    expect(html).toContain('const a = 1;');
  });

  it('renders a checklist item with a box', () => {
    const html = renderMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('task-item');
    expect(html.match(/task-check/g)).toHaveLength(2);
    expect(html).toContain('checked');
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
});
