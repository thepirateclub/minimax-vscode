import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import {
  IconAttach,
  IconCaret,
  IconCheck,
  IconCode,
  IconGoal,
  IconClose,
  IconCopy,
  IconEdit,
  IconGit,
  IconGraph,
  IconHistory,
  IconList,
  IconMic,
  IconModel,
  IconPlan,
  IconPlus,
  IconRetry,
  IconRead,
  IconRewind,
  IconSearch,
  IconSend,
  IconStop,
  IconTerminal,
  IconThinking,
  IconWrite
} from '../../src/ui/webview/icons';
import { CODICON_DEBUG_STOP, CODICON_SEND } from '../../src/ui/webview/codicons';
import { markupBBox, pathPoints } from '../helpers/iconGeometry';

const ICONS: Array<[string, () => ReactNode]> = [
  ['IconAttach', IconAttach],
  ['IconCaret', IconCaret],
  ['IconCheck', IconCheck],
  ['IconCode', IconCode],
  ['IconClose', IconClose],
  ['IconCopy', IconCopy],
  ['IconEdit', IconEdit],
  ['IconGit', IconGit],
  ['IconGraph', IconGraph],
  ['IconHistory', IconHistory],
  ['IconList', IconList],
  ['IconMic', IconMic],
  ['IconModel', IconModel],
  ['IconPlan', IconPlan],
  ['IconPlus', IconPlus],
  ['IconRead', IconRead],
  ['IconRewind', IconRewind],
  ['IconSearch', IconSearch],
  ['IconSend', IconSend],
  ['IconStop', IconStop],
  ['IconTerminal', IconTerminal],
  ['IconThinking', IconThinking],
  ['IconWrite', IconWrite]
];

function renderIcon(render: () => ReactNode): { markup: string; viewBox: number[] } {
  const markup = renderToStaticMarkup(render() as ReactElement);
  const viewBoxMatch = /viewBox="([^"]+)"/.exec(markup);
  const viewBox = (viewBoxMatch?.[1] ?? '0 0 16 16').split(/[\s,]+/).map(Number);
  return { markup, viewBox };
}

// The path of an icon, the send icon is a single shape.
function pathOf(markup: string): string {
  return /<path d="([^"]+)"/.exec(markup)?.[1] ?? '';
}

// The width the icon is drawn with, the panel measures the icons in pixels.
function sizeOf(markup: string): number {
  return Number(/width="([\d.]+)"/.exec(markup)?.[1] ?? '0');
}

// The body of a rule of the style sheet, the selector is taken literally.
function cssRule(css: string, selector: string): string {
  const match = new RegExp('\\' + selector + '\\s*\\{([^}]*)\\}').exec(css);
  return match?.[1] ?? '';
}

// The panel draws the icons in a tiny square, a glyph that hangs to one side
// looks broken even when the path itself is correct.
describe('panel icons', () => {
  for (const [name, render] of ICONS) {
    it(name + ' keeps the ink centered in its box', () => {
      const { markup, viewBox } = renderIcon(render);
      const box = markupBBox(markup);
      const centerX = (box.minX + box.maxX) / 2;
      const centerY = (box.minY + box.maxY) / 2;
      const expectedX = ((viewBox[0] ?? 0) + (viewBox[2] ?? 0)) / 2;
      const expectedY = ((viewBox[1] ?? 0) + (viewBox[3] ?? 0)) / 2;
      console.log(
        name,
        JSON.stringify({
          viewBox,
          minX: Number(box.minX.toFixed(2)),
          minY: Number(box.minY.toFixed(2)),
          maxX: Number(box.maxX.toFixed(2)),
          maxY: Number(box.maxY.toFixed(2)),
          offsetX: Number((centerX - expectedX).toFixed(2)),
          offsetY: Number((centerY - expectedY).toFixed(2))
        })
      );
      expect(Number.isFinite(box.minX)).toBe(true);
      expect(Math.abs(centerX - expectedX)).toBeLessThan(0.9);
      expect(Math.abs(centerY - expectedY)).toBeLessThan(0.9);
    });
  }

  it('centers the icon inside the square button of the header', () => {
    const css = readFileSync(
      new URL('../../src/ui/webview/styles.css', import.meta.url),
      'utf8'
    );
    const rules = Array.from(css.matchAll(/\.icon-button \{([^}]*)\}/g)).map(
      (match) => match[1] ?? ''
    );
    const centered = rules.some(
      (rule) =>
        rule.includes('display: inline-flex') &&
        rule.includes('align-items: center') &&
        rule.includes('justify-content: center')
    );
    expect(centered).toBe(true);
  });
});

// The send and the stop glyphs are taken from the icon set of VS Code, the
// font codicon.ttf that ships with the editor. The codicons are contours of
// a font, so they are filled, not stroked.
describe('send and stop icons of the codicon set', () => {
  it('fills the glyph instead of stroking it', () => {
    const { markup } = renderIcon(IconSend);
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('stroke="none"');
  });

  it('draws the arrow of the codicon "send"', () => {
    expect(pathOf(renderIcon(IconSend).markup)).toBe(CODICON_SEND);
  });

  it('draws the square of the codicon "debug-stop"', () => {
    expect(pathOf(renderIcon(IconStop).markup)).toBe(CODICON_DEBUG_STOP);
  });

  it('keeps the proportions of the arrow from the font', () => {
    const box = markupBBox(renderIcon(IconSend).markup);
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    // The glyph of the font is 264 units wide and 266 units tall.
    expect(width / height).toBeGreaterThan(0.95);
    expect(width / height).toBeLessThan(1.03);
  });

  it('points the nose of the arrow to the right and to the middle', () => {
    const { markup, viewBox } = renderIcon(IconSend);
    const points = pathPoints(pathOf(markup));
    let nose = points[0] ?? [0, 0];
    for (const point of points) {
      if (point[0] > nose[0]) {
        nose = point;
      }
    }
    const middleY = ((viewBox[1] ?? 0) + (viewBox[3] ?? 0)) / 2;
    const rightEdge = (viewBox[0] ?? 0) + (viewBox[2] ?? 0);
    expect(nose[0]).toBeGreaterThan(rightEdge * 0.85);
    expect(Math.abs(nose[1] - middleY)).toBeLessThan(0.6);
  });

  it('keeps the hole of the arrow open', () => {
    // The codicon is a contour with a second shape inside, the arrow keeps
    // the hole between the wings.
    const d = pathOf(renderIcon(IconSend).markup);
    expect((d.match(/Z/g) ?? []).length).toBe(2);
  });

  it('shows the arrow and the paperclip at the same size', () => {
    const send = sizeOf(renderIcon(IconSend).markup);
    const attach = sizeOf(renderIcon(IconAttach).markup);
    expect(send).toBe(attach);
    expect(send).toBe(14);
  });

  it('shows the square of the stop at the size of the arrow', () => {
    const stop = sizeOf(renderIcon(IconStop).markup);
    expect(stop).toBe(sizeOf(renderIcon(IconSend).markup));
  });

  it('paints the send button like the paperclip', () => {
    const css = readFileSync(
      new URL('../../src/ui/webview/styles.css', import.meta.url),
      'utf8'
    );
    expect(cssRule(css, '.composer-send')).toContain('color: var(--muted)');
    expect(cssRule(css, '.composer-attach')).toContain('color: var(--muted)');
  });

  it('keeps the red of the stop button when the mouse is over it', () => {
    const css = readFileSync(
      new URL('../../src/ui/webview/styles.css', import.meta.url),
      'utf8'
    );
    expect(cssRule(css, '.composer-send.stop:hover')).toContain('color: var(--err)');
  });
});

// The icons that stand side by side in the panel are one family: the lucide
// grid of 24 units, a line of 2 units and 14 pixels on the screen. A hand
// drawn icon on the grid of 16 looked thinner, a 16 pixel one looked louder.
describe('one family of the icons', () => {
  const FAMILY: Array<[string, () => ReactNode]> = [
    ['IconAttach', IconAttach],
    ['IconClose', IconClose],
    ['IconCode', IconCode],
    ['IconGoal', IconGoal],
    ['IconHistory', IconHistory],
    ['IconMic', IconMic],
    ['IconModel', IconModel],
    ['IconPlan', IconPlan],
    ['IconPlus', IconPlus],
    ['IconRetry', IconRetry],
    ['IconRewind', IconRewind],
    ['IconThinking', IconThinking]
  ];
  for (const [name, render] of FAMILY) {
    it(name + ' sits on the lucide grid with the common line and size', () => {
      const { markup, viewBox } = renderIcon(render);
      expect(viewBox).toEqual([0, 0, 24, 24]);
      expect(markup).toContain('stroke-width="2"');
      expect(sizeOf(markup)).toBe(14);
    });
  }
});
