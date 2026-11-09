import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import {
  IconAttach,
  IconCaret,
  IconCode,
  IconCopy,
  IconEdit,
  IconGraph,
  IconHistory,
  IconList,
  IconModel,
  IconPlan,
  IconRead,
  IconSearch,
  IconTerminal,
  IconThinking,
  IconWrite
} from '../../src/ui/webview/icons';
import { markupBBox } from '../helpers/iconGeometry';

const ICONS: Array<[string, () => ReactNode]> = [
  ['IconAttach', IconAttach],
  ['IconCaret', IconCaret],
  ['IconCode', IconCode],
  ['IconCopy', IconCopy],
  ['IconEdit', IconEdit],
  ['IconGraph', IconGraph],
  ['IconHistory', IconHistory],
  ['IconList', IconList],
  ['IconModel', IconModel],
  ['IconPlan', IconPlan],
  ['IconRead', IconRead],
  ['IconSearch', IconSearch],
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
