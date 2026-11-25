import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import {
  IconAlert,
  IconAttach,
  IconCaret,
  IconCheck,
  IconClock,
  IconClose,
  IconCode,
  IconCopy,
  IconDelete,
  IconEdit,
  IconFolder,
  IconGit,
  IconHistory,
  IconLayers,
  IconList,
  IconMic,
  IconModel,
  IconPlan,
  IconPlus,
  IconPriorityHigh,
  IconPriorityLow,
  IconPriorityMedium,
  IconPriorityVeryHigh,
  IconRead,
  IconRefresh,
  IconRetry,
  IconRewind,
  IconSearch,
  IconSend,
  IconStop,
  IconTerminal,
  IconThinking,
  IconWrite
} from '../../src/ui/webview/icons';
import { markupBBox } from '../helpers/iconGeometry';
import { readStyles } from '../helpers/styles';

const ICONS: Array<[string, () => ReactNode]> = [
  ['IconAlert', IconAlert],
  ['IconAttach', IconAttach],
  ['IconCaret', IconCaret],
  ['IconCheck', IconCheck],
  ['IconClock', IconClock],
  ['IconClose', IconClose],
  ['IconCode', IconCode],
  ['IconCopy', IconCopy],
  ['IconDelete', IconDelete],
  ['IconEdit', IconEdit],
  ['IconFolder', IconFolder],
  ['IconGit', IconGit],
  ['IconHistory', IconHistory],
  ['IconLayers', IconLayers],
  ['IconList', IconList],
  ['IconMic', IconMic],
  ['IconModel', IconModel],
  ['IconPlan', IconPlan],
  ['IconPlus', IconPlus],
  ['IconPriorityHigh', IconPriorityHigh],
  ['IconPriorityLow', IconPriorityLow],
  ['IconPriorityMedium', IconPriorityMedium],
  ['IconPriorityVeryHigh', IconPriorityVeryHigh],
  ['IconRead', IconRead],
  ['IconRefresh', IconRefresh],
  ['IconRetry', IconRetry],
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
  const viewBox = (viewBoxMatch?.[1] ?? '0 0 24 24').split(/[\s,]+/).map(Number);
  return { markup, viewBox };
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

// The sparkles of the set of lucide keeps the canonical geometry: the big
// spark stands in the upper left, the small ones stand in the corners. The
// ink of that icon does not sit in the middle of the box, the check of the
// center does not apply to it.
const NOT_CENTERED = new Set(['IconThinking']);

// The panel draws the icons in a tiny square, a glyph that hangs to one side
// looks broken even when the path itself is correct.
describe('panel icons', () => {
  for (const [name, render] of ICONS.filter(([icon]) => !NOT_CENTERED.has(icon))) {
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
    const css = readStyles();
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

// The icons that stand side by side in the panel are one family: the lucide
// grid of 24 units, a line of 2 units and 14 pixels on the screen. A hand
// drawn icon on the grid of 16 looked thinner, a 16 pixel one looked louder.
describe('one family of the icons', () => {
  for (const [name, render] of ICONS) {
    it(name + ' sits on the lucide grid with the common line and size', () => {
      const { markup, viewBox } = renderIcon(render);
      expect(viewBox).toEqual([0, 0, 24, 24]);
      expect(markup).toContain('stroke-width="2"');
      expect(sizeOf(markup)).toBe(14);
      // The family is drawn with a line, a filled glyph belongs to another
      // set and looks louder next to the neighbours.
      expect(markup).toContain('fill="none"');
      expect(markup).not.toContain('fill="currentColor"');
    });
  }
});

// The buttons of the field keep the colour of their neighbours.
describe('the buttons of the field', () => {
  const css = readStyles();

  it('points the arrow of the send button up', () => {
    const { markup } = renderIcon(IconSend);
    // The nose of the arrow stands on the top, the request goes out.
    expect(markup).toContain('m5 12 7-7 7 7');
    expect(markup).toContain('M12 19V5');
  });

  it('draws the stop button as a square', () => {
    const { markup } = renderIcon(IconStop);
    expect(markup).toContain('rect');
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
    expect(cssRule(css, '.composer-send')).toContain('color: var(--muted)');
    expect(cssRule(css, '.composer-attach')).toContain('color: var(--muted)');
  });

  it('keeps the red of the stop button when the mouse is over it', () => {
    expect(cssRule(css, '.composer-send.stop:hover')).toContain('color: var(--err)');
  });
});
