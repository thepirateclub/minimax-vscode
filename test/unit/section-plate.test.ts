import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readStyles } from '../helpers/styles';

// The plate of the head of a section. The name of the section and the marks
// of it stand on one quiet plate, and the plate has the same space on both
// sides: the name of the section must not touch its edge.
//
// The general rule of the buttons paints every button of the panel with the
// fill of the primary button on hover. A button that keeps a quiet fill and
// has no rule of its own for the hover takes that fill. The head of a
// section was painted with it, the plate ended right after the name of the
// section and the reader saw half of a highlight.

const CSS = readStyles();

interface Rule {
  selector: string;
  body: string;
}

function rules(): Rule[] {
  const sheet = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const result: Rule[] = [];
  for (const match of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    result.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '' });
  }
  return result;
}

function declarations(body: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of body.split(';')) {
    const index = part.indexOf(':');
    if (index === -1) {
      continue;
    }
    result.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return result;
}

function rule(selector: string): Map<string, string> {
  const found = rules().find((item) =>
    item.selector.split(',').some((part) => part.trim() === selector)
  );
  return declarations(found?.body ?? '');
}

// The left and the right of a padding shorthand.
function sides(value: string): { left: number; right: number } {
  const parts = value
    .trim()
    .split(/\s+/)
    .map((part) => Number.parseFloat(part) || 0);
  if (parts.length === 1) {
    return { left: parts[0]!, right: parts[0]! };
  }
  if (parts.length === 2 || parts.length === 3) {
    return { left: parts[1]!, right: parts[1]! };
  }
  return { left: parts[3]!, right: parts[1]! };
}

// The background of a class on hover: the last rule of the sheet wins.
function hoverBackgrounds(): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of rules()) {
    for (const part of item.selector.split(',')) {
      const match = /^\.([\w-]+):hover$/.exec(part.trim());
      if (!match) {
        continue;
      }
      const value = declarations(item.body).get('background');
      if (value !== undefined) {
        result.set(match[1]!, value);
      }
    }
  }
  return result;
}

// The text of the opening tag of a button: the arrow of a function inside
// the attributes is not the end of the tag.
function openingTag(text: string, from: number): string | null {
  let quote = '';
  for (let index = from; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '=' && text[index + 1] === '>') {
      index += 1;
      continue;
    }
    if (char === '>') {
      return text.slice(from, index);
    }
  }
  return null;
}

// The class names of a tag: a literal string or the first part of an
// expression, the rest of it is a state of the element.
function classNames(tag: string): string[] {
  const match = /className=(?:"([^"]*)"|\{'([^']*)'|\{`([^`]*)`)/.exec(tag);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
  return raw.split(/\s+/).filter((item) => /^[a-z][\w-]*$/.test(item));
}

// The classes of every button of the panel: the sheet alone does not know
// which class belongs to a button.
function buttonClasses(): string[][] {
  const dir = new URL('../../src/ui/webview/components/', import.meta.url);
  const result: string[][] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsx')) {
      continue;
    }
    const text = readFileSync(new URL(name, dir), 'utf8');
    for (const match of text.matchAll(/<button\b/g)) {
      const tag = openingTag(text, match.index + '<button'.length);
      if (tag === null) {
        continue;
      }
      const classes = classNames(tag);
      if (classes.length > 0) {
        result.push(classes);
      }
    }
  }
  return result;
}

describe('the plate of the head of a section', () => {
  it('has the same space on both sides of the name', () => {
    const padding = sides(rule('.section-toggle').get('padding') ?? '');
    expect(padding.left).toBeGreaterThan(0);
    expect(padding.right).toBe(padding.left);
  });

  it('keeps the chevron on the left edge of the row', () => {
    // The plate of the hover goes into the margin of the panel, the chevron
    // keeps its place: the margin and the padding of the plate cancel each
    // other.
    const margin = Number.parseFloat(
      rule('.section-toggle').get('margin-left') ?? '0'
    );
    const padding = sides(rule('.section-toggle').get('padding') ?? '');
    expect(margin + padding.left).toBe(0);
  });

  it('does not take the fill of the primary button on hover', () => {
    const hover = rule('.section-toggle:hover').get('background');
    expect(hover).toBeDefined();
    expect(hover ?? '').not.toContain('--vscode-button');
    // The plate of the head is quiet, the reader sees a row and not a button.
    expect(hover).not.toBe('transparent');
  });

  it('keeps the preview of the section without a fill of its own', () => {
    // The preview stands in the same row as the name of the section: the
    // plate of the row carries the hover.
    expect(rule('.section-preview:hover').get('background')).toBe('transparent');
  });
});

describe('the plates of the summary of the files', () => {
  it('has the same space on both sides of the name of the file', () => {
    const padding = sides(rule('.summary-file').get('padding') ?? '');
    expect(padding.left).toBeGreaterThan(0);
    expect(padding.right).toBe(padding.left);
  });

  it('keeps the names on the left edge of the bar', () => {
    // The plate of the hover goes into the margin of the bar, the names keep
    // their place.
    const margin = sides(rule('.summary-file').get('margin') ?? '');
    expect(margin.left).toBeLessThan(0);
  });

  it('has the same space on both sides of the bar', () => {
    const padding = sides(rule('.summary-bar').get('padding') ?? '');
    expect(padding.right).toBe(padding.left);
  });

  it('does not take the fill of the primary button on hover', () => {
    const hover = rule('.summary-clear:hover').get('background');
    expect(hover).toBeDefined();
    expect(hover ?? '').not.toContain('--vscode-button');
  });

  it('draws the cross as a square button', () => {
    // The icon stands in the middle of the square: the plate of the hover
    // keeps the same space on both sides of it.
    expect(rule('.summary-clear').get('width')).toBe('var(--control-h)');
    expect(rule('.summary-clear').get('height')).toBe('var(--control-h)');
  });
});

describe('the buttons of the panel', () => {
  it('never take the fill of the primary button on hover', () => {
    // The general rule of the buttons paints a button with the fill of the
    // primary button on hover. A button that keeps a quiet fill and has no
    // rule of its own for the hover takes that fill, and the plate of the
    // panel stops being quiet.
    const quiet = new Set<string>();
    for (const item of rules()) {
      const value = declarations(item.body).get('background');
      if (value !== 'transparent' && value !== 'none') {
        continue;
      }
      for (const part of item.selector.split(',')) {
        const match = /^\.([\w-]+)$/.exec(part.trim());
        if (match) {
          quiet.add(match[1]!);
        }
      }
    }
    const hovers = hoverBackgrounds();
    const wrong = new Set<string>();
    for (const classes of buttonClasses()) {
      for (const name of classes) {
        if (!quiet.has(name)) {
          continue;
        }
        const hover = hovers.get(name);
        if (hover === undefined || hover.includes('--vscode-button')) {
          wrong.add(name);
        }
      }
    }
    expect([...wrong]).toEqual([]);
  });
});
