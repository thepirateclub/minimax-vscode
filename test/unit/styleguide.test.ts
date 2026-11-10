import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The panel follows docs/styleguide.md. The rules below read the style sheet
// and keep every size, radius, shadow and color on the scale of the guide.
const CSS = readFileSync(
  new URL('../../src/ui/webview/styles.css', import.meta.url),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

interface Declaration {
  selector: string;
  property: string;
  value: string;
}

// The flat rules of the sheet, the block of the keyframes is skipped.
function declarations(): Declaration[] {
  const sheet = CSS.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '');
  const result: Declaration[] = [];
  for (const match of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = (match[1] ?? '').trim();
    for (const part of (match[2] ?? '').split(';')) {
      const index = part.indexOf(':');
      if (index === -1) {
        continue;
      }
      result.push({
        selector,
        property: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim()
      });
    }
  }
  return result;
}

const ALL = declarations();
// The custom properties are the tokens, the rules below check their use.
const USES = ALL.filter((item) => !item.property.startsWith('--'));

function token(name: string): string | undefined {
  return ALL.find((item) => item.selector === 'body' && item.property === name)?.value;
}

function pixels(value: string): number[] {
  return Array.from(value.matchAll(/(-?\d+(?:\.\d+)?)px/g)).map((match) =>
    Math.abs(Number(match[1]))
  );
}

describe('styleguide tokens', () => {
  it('counts the type scale from the base size of the panel', () => {
    expect(token('--fs-xs')).toBe('calc(var(--mm-font-base) * 0.77)');
    expect(token('--fs-sm')).toBe('calc(var(--mm-font-base) * 0.85)');
    expect(token('--fs-md')).toBe('calc(var(--mm-font-base) * 0.92)');
    expect(token('--fs-base')).toBe('var(--mm-font-base)');
  });

  it('builds the colors of the meaning on the theme of the host', () => {
    expect(token('--ok')).toContain('--vscode-testing-iconPassed');
    expect(token('--err')).toContain('--vscode-testing-iconFailed');
    expect(token('--accent')).toContain('--vscode-textLink-foreground');
    expect(token('--muted')).toContain('--vscode-descriptionForeground');
  });

  it('keeps one radius pair, one control size and one shadow', () => {
    expect(token('--radius-sm')).toBe('4px');
    expect(token('--radius')).toBe('6px');
    expect(token('--control-h')).toBe('22px');
    expect(token('--dot')).toBe('8px');
    expect(token('--shadow')).toBeDefined();
  });
});

describe('styleguide rules', () => {
  it('sets every font size from the type scale', () => {
    const wrong = USES.filter(
      (item) =>
        item.property === 'font-size' &&
        !/^var\(--fs-(xs|sm|md|base)\)$/.test(item.value) &&
        !/^\d+(\.\d+)?em$/.test(item.value) &&
        item.value !== 'inherit'
    );
    expect(wrong).toEqual([]);
  });

  it('uses two weights only', () => {
    const wrong = USES.filter(
      (item) => item.property === 'font-weight' && !['400', '600'].includes(item.value)
    );
    expect(wrong).toEqual([]);
  });

  it('rounds the corners with the tokens', () => {
    const allowed = new Set(['var(--radius-sm)', 'var(--radius)', '0', '50%', '999px']);
    const wrong = USES.filter(
      (item) => item.property === 'border-radius' && !allowed.has(item.value)
    );
    expect(wrong).toEqual([]);
  });

  it('keeps the spacing on the scale of the guide', () => {
    const scale = new Set([0, 1, 2, 4, 6, 8, 12, 16, 24, 32]);
    const wrong = USES.filter(
      (item) =>
        /^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(item.property) &&
        pixels(item.value).some((value) => !scale.has(value))
    );
    expect(wrong).toEqual([]);
  });

  it('casts one shadow', () => {
    const wrong = USES.filter(
      (item) => item.property === 'box-shadow' && item.value !== 'var(--shadow)'
    );
    expect(wrong).toEqual([]);
  });

  it('takes the colors from the theme, a bare hex is only a fallback', () => {
    // The palettes of the tokens and of the diff are the only bare colors,
    // they live in the custom properties and stay out of this check.
    const wrong = USES.filter(
      (item) => /#[0-9a-f]{3,8}\b/i.test(item.value) && !item.value.includes('var(--vscode-')
    );
    expect(wrong).toEqual([]);
  });

  it('paints a failure in one red', () => {
    const reds = USES.filter((item) => item.value.includes('iconFailed') || item.value.includes('errorForeground'));
    // The red comes through the token, the rules do not name the theme color.
    expect(reds).toEqual([]);
  });

  it('takes the scroll bar back from the default styles of the host', () => {
    // VS Code sets scrollbar-color on the html, and while it is set the
    // webkit rules of the bar are ignored.
    const reset = USES.find((item) => item.selector === 'html' && item.property === 'scrollbar-color');
    expect(reset?.value).toBe('auto');
  });

  it('outlines a button with the border of the theme', () => {
    // The modern themes draw a secondary button with a clear fill, the
    // outline comes from --vscode-button-border.
    const border = USES.find((item) => item.selector === 'button' && item.property === 'border');
    expect(border?.value).toContain('--vscode-button-border');
  });

  it('frames every block of a monospace text', () => {
    // Light Modern paints the code ground in the color of the side bar, a
    // block held by its fill alone melts into the panel.
    const blocks = ['.tool-input, .tool-output', '.thinking-body', '.diff, .file-read, .term', '.markdown .code-block'];
    for (const selector of blocks) {
      const border = USES.find(
        (item) => item.selector.replace(/\s+/g, ' ') === selector && item.property === 'border'
      );
      expect(border?.value, selector).toBe('1px solid var(--border)');
    }
  });

  it('paints a transparent fill only on a plain ground', () => {
    // A transparent bar over the grid of the graph striped the column.
    const input = USES.find((item) => item.selector === '.usage-input' && item.property === 'opacity');
    expect(input).toBeUndefined();
  });
});

// The px values of one property of a rule, in the order of the shorthand.
function box(selector: string, property: string): number[] {
  const value = USES.find(
    (item) => item.selector.replace(/\s+/g, ' ') === selector && item.property === property
  )?.value;
  expect(value, selector + ' ' + property).toBeDefined();
  return (value ?? '').split(/\s+/).map((part) => Number.parseFloat(part) || 0);
}

// The left side of a padding or a margin shorthand.
function leftOf(values: number[]): number {
  return values.length === 4 ? values[3]! : values.length >= 2 ? values[1]! : values[0]!;
}

describe('styleguide alignment', () => {
  it('puts the label of the first tab on the left edge of the panel', () => {
    expect(leftOf(box('.tabs', 'margin-left')) + leftOf(box('.tab', 'padding'))).toBe(0);
  });

  it('puts the chevron of an action on the left edge, the hover goes into the margin', () => {
    const margin = leftOf(box('.tool-card', 'margin'));
    expect(margin + leftOf(box('.tool-head', 'padding'))).toBe(0);
    expect(margin + leftOf(box('.tool-body', 'padding'))).toBe(0);
  });

  it('keeps the text of a failed action and of a notice on the edge, the bar in the margin', () => {
    const bar = 2;
    const card = leftOf(box('.tool-card', 'margin'));
    const failed = box('.tool-card.tool-error .tool-head, .tool-card.tool-error .tool-body', 'padding-left');
    expect(card + bar + failed[0]!).toBe(0);
    const notice = box('.message-notice', 'margin-left')[0]! + bar + leftOf(box('.message-notice', 'padding'));
    expect(notice).toBe(0);
  });

  it('indents the text of every monospace block by one step', () => {
    // A block of code, of a diff, of an output and of a terminal start their
    // text at the same depth, the eye reads them as one family.
    expect(leftOf(box('.tool-input, .tool-output', 'padding'))).toBe(8);
    expect(leftOf(box('.thinking-body', 'padding'))).toBe(8);
    expect(leftOf(box('.markdown pre', 'padding'))).toBe(8);
    expect(leftOf(box('.markdown .code-head', 'padding'))).toBe(8);
    expect(leftOf(box('.term-body', 'padding'))).toBe(8);
    expect(leftOf(box('.term-command', 'padding'))).toBe(8);
    expect(leftOf(box('.file-read-line', 'padding'))).toBe(8);
    expect(box('.diff-marker', 'padding-left')[0]).toBe(8);
  });

  it('puts the boxes of a checklist on the left edge of the text', () => {
    expect(box('.markdown .task-list', 'padding-left')[0]).toBe(0);
  });
});

describe('styleguide icons', () => {
  const dir = new URL('../../src/ui/webview/components/', import.meta.url);
  const sources = readdirSync(dir)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }));

  it('draws the chevrons with the icon, not with a letter', () => {
    for (const source of sources) {
      expect(source.text, source.name).not.toMatch(/[▸▾▴◂]/);
    }
  });

  it('draws the crosses with the icon, the chip inside the input field excepted', () => {
    for (const source of sources) {
      const crosses = source.text.match(/×/g)?.length ?? 0;
      // The chip of a file lives in the editable field, an svg moves the caret.
      expect(crosses, source.name).toBe(source.name === 'Composer.tsx' ? 1 : 0);
    }
  });
});
