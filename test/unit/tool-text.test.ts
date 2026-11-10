import { describe, expect, it } from 'vitest';
import { approvalTitle, formatInput } from '../../src/ui/webview/toolText';
import { renderMarkdown } from '../../src/ui/webview/markdown';

describe('the question of an approval', () => {
  it('names the action and the file, not the tool', () => {
    expect(approvalTitle('write_file', { path: 'src/app.ts' })).toBe('Write src/app.ts?');
    expect(approvalTitle('edit_file', { path: 'src/app.ts' })).toBe('Edit src/app.ts?');
  });

  it('asks about a command without repeating it, the body shows it', () => {
    expect(approvalTitle('run_terminal', { command: 'npm test' })).toBe('Run this command?');
  });

  it('keeps the name of an unknown tool', () => {
    expect(approvalTitle('web_search', { query: 'x' })).toBe('Run web_search?');
  });

  it('lists the arguments instead of a json dump', () => {
    expect(formatInput({ path: 'a.ts', empty: '' })).toBe('path: a.ts');
  });
});

describe('the copy button of a code block', () => {
  it('is an icon that turns into a check', () => {
    const html = renderMarkdown('```ts\nconst a = 1;\n```');
    const button = /<button type="button" class="code-copy"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(button).not.toBeNull();
    expect(button?.[1]).toContain('icon-copy');
    expect(button?.[1]).toContain('icon-check');
    expect(button?.[1]).not.toContain('Copy');
  });
});
