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
