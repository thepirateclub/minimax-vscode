import { describe, expect, it } from 'vitest';
import { escapeHtml, highlight, supportsLanguage } from '../../src/ui/webview/highlight';

describe('highlight', () => {
  it('marks the keywords and the numbers of TypeScript', () => {
    const html = highlight('const a = 1;', 'ts');
    expect(html).toContain('<span class="tok-keyword">const</span>');
    expect(html).toContain('<span class="tok-number">1</span>');
  });

  it('marks a call of a function', () => {
    expect(highlight('trimHistory(a);', 'ts')).toContain(
      '<span class="tok-function">trimHistory</span>'
    );
  });

  it('marks a class name as a type', () => {
    expect(highlight('new AgentSession();', 'ts')).toContain(
      '<span class="tok-type">AgentSession</span>'
    );
  });

  it('marks a comment and a string', () => {
    expect(highlight('// note', 'ts')).toContain('<span class="tok-comment">// note</span>');
    expect(highlight("const a = 'x';", 'ts')).toContain(
      '<span class="tok-string">&#39;x&#39;</span>'
    );
  });

  it('marks the keys of json', () => {
    const html = highlight('{"a": 1}', 'json');
    expect(html).toContain('<span class="tok-attribute">&quot;a&quot;</span>');
    expect(html).toContain('<span class="tok-number">1</span>');
  });

  it('marks a comment and a docstring of python', () => {
    expect(highlight('# note', 'py')).toContain('tok-comment');
    expect(highlight('"""doc"""', 'py')).toContain('tok-string');
  });

  it('marks the tags and the attributes of html', () => {
    const html = highlight('<div class="a">x</div>', 'html');
    expect(html).toContain('<span class="tok-tag">&lt;div</span>');
    expect(html).toContain('<span class="tok-attribute">class</span>');
    expect(html).toContain('<span class="tok-string">&quot;a&quot;</span>');
  });

  it('marks the added and the removed lines of a diff', () => {
    const html = highlight('+ added\n- removed', 'diff');
    expect(html).toContain('tok-add');
    expect(html).toContain('tok-remove');
  });

  it('keeps an unknown language plain', () => {
    expect(highlight('a < b', 'brainfuck')).toBe('a &lt; b');
  });

  it('escapes the html of the code', () => {
    expect(highlight('<script>', 'text')).toBe('&lt;script&gt;');
    expect(escapeHtml('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('knows the languages it can paint', () => {
    expect(supportsLanguage('TypeScript')).toBe(true);
    expect(supportsLanguage('tsx')).toBe(true);
    expect(supportsLanguage('unknown')).toBe(false);
  });
});
