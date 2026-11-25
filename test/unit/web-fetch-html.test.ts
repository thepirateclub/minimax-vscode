import { describe, expect, it } from 'vitest';
import { decodeEntities, htmlToText } from '../../src/tools/web/html';

// The page is read as text: the words stay, the markup of the page goes away.
// The extension carries no html parser, the tags are read by hand.
describe('the text of a page', () => {
  it('takes the words of the page without the tags', () => {
    const page = htmlToText(
      '<html><body><h1>Title of the page</h1><p>The first paragraph.</p>' +
        '<div><span>The second one.</span></div></body></html>'
    );
    expect(page.text).toContain('Title of the page');
    expect(page.text).toContain('The first paragraph.');
    expect(page.text).toContain('The second one.');
    // A tag in the answer is a defect: the model reads the words of the page.
    expect(page.text).not.toContain('<');
    expect(page.text).not.toContain('>');
  });

  it('drops the scripts and the styles', () => {
    const page = htmlToText(
      '<html><head><style>body { color: red; }</style>' +
        '<script>alert("boom");</script></head>' +
        '<body><p>The text of the page.</p></body></html>'
    );
    expect(page.text).toContain('The text of the page.');
    expect(page.text).not.toContain('alert');
    expect(page.text).not.toContain('color: red');
  });

  it('drops the navigation and the service parts', () => {
    const page = htmlToText(
      '<body><nav><a href="/">Home</a><a href="/about">About</a></nav>' +
        '<aside>Advertisement</aside><form><input name="q"></form>' +
        '<main><p>The content of the article.</p></main></body>'
    );
    expect(page.text).toContain('The content of the article.');
    expect(page.text).not.toContain('Home');
    expect(page.text).not.toContain('Advertisement');
  });

  it('expands the entities of the text', () => {
    const page = htmlToText('<p>Tom &amp; Jerry, a&nbsp;word, &#65;, &#x42; and &lt;tag&gt;</p>');
    expect(page.text).toContain('Tom & Jerry');
    expect(page.text).toContain('a word');
    expect(page.text).toContain('A');
    expect(page.text).toContain('B');
    expect(page.text).toContain('<tag>');
    // The entity of the page must not reach the model as it is.
    expect(page.text).not.toContain('&amp;');
    expect(page.text).not.toContain('&nbsp;');
  });

  it('collapses the spaces and the empty lines', () => {
    const page = htmlToText('<p>One     two</p>' + '\n\n\n' + '<p>Three</p>');
    expect(page.text).toContain('One two');
    expect(page.text).not.toContain('One     two');
    // The empty lines of the page do not come as a wall of blank lines.
    expect(page.text).not.toMatch(/\n{3,}/);
  });

  it('reads the title of the page apart', () => {
    const page = htmlToText(
      '<html><head><title>The title of the page</title></head><body><p>The text.</p></body></html>'
    );
    expect(page.title).toBe('The title of the page');
    expect(page.text).not.toContain('The title of the page');
  });

  it('keeps the code of the page with its spaces', () => {
    const page = htmlToText(
      '<div><pre><code>const a = 1;\n  const b = 2;\n</code></pre></div>'
    );
    expect(page.text).toContain('const a = 1;');
    expect(page.text).toContain('  const b = 2;');
  });

  it('has no title when the page has none', () => {
    expect(htmlToText('<p>Only the text.</p>').title).toBe('');
  });
});

describe('the entities of a page', () => {
  it('expands the named and the numeric ones', () => {
    expect(decodeEntities('a &amp; b')).toBe('a & b');
    expect(decodeEntities('&lt;p&gt;')).toBe('<p>');
    expect(decodeEntities('&quot;q&quot;')).toBe('"q"');
    expect(decodeEntities('&#8212;')).toBe('\u2014');
    expect(decodeEntities('&#x2014;')).toBe('\u2014');
    expect(decodeEntities('&hellip;')).toBe('\u2026');
  });

  it('keeps a word that is not an entity', () => {
    expect(decodeEntities('a & b')).toBe('a & b');
    expect(decodeEntities('&unknownentity;')).toBe('&unknownentity;');
  });
});
