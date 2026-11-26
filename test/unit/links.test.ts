import { describe, expect, it } from 'vitest';
import { linkTarget } from '../../src/ui/webview/links';

describe('the links of an answer', () => {
  it('open a web page, a file of the project or nothing', () => {
    expect(linkTarget('https://example.com/a')).toEqual({ kind: 'web', url: 'https://example.com/a' });
    expect(linkTarget('src/a.ts#L12')).toEqual({ kind: 'file', path: 'src/a.ts', line: 12 });
    expect(linkTarget('./src/a.ts:7')).toEqual({ kind: 'file', path: 'src/a.ts', line: 7 });
    expect(linkTarget('README.md')).toEqual({ kind: 'file', path: 'README.md' });
    for (const href of ['javascript:alert(1)', 'command:workbench.action.quit', 'file:///etc/passwd', '#top', '//evil.example/x']) {
      expect(linkTarget(href), href).toBeUndefined();
    }
  });
});

describe('a broken escape in a link', () => {
  it('stays a literal name instead of a crash of the click', () => {
    expect(linkTarget('src/a%zz.ts')).toEqual({ kind: 'file', path: 'src/a%zz.ts' });
  });
});
