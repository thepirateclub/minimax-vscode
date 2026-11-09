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
  IconSend,
  IconStop,
  IconTerminal,
  IconThinking,
  IconWrite
} from '../../src/ui/webview/icons';
import { markupBBox, pathPoints } from '../helpers/iconGeometry';

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

// The left edge of a shape on a horizontal line, the polyline is crossed
// with the line and the leftmost crossing wins.
function leftEdge(points: Array<[number, number]>, y: number): number {
  const xs: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if ((a[1] > y) === (b[1] > y)) {
      continue;
    }
    const t = (y - a[1]) / (b[1] - a[1]);
    xs.push(a[0] + (b[0] - a[0]) * t);
  }
  return xs.length > 0 ? Math.min(...xs) : Number.NaN;
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

// The picture the user gave is the measure: a solid arrow that points to
// the right, with a horizontal slot between the two wings and a tail that
// folds back to the left.
describe('send icon of the reference picture', () => {
  it('fills the arrow instead of stroking it', () => {
    const { markup } = renderIcon(IconSend);
    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('stroke="none"');
  });

  it('keeps the proportions of the arrow from the picture', () => {
    const { markup } = renderIcon(IconSend);
    const box = markupBBox(markup);
    const width = box.maxX - box.minX;
    const height = box.maxY - box.minY;
    // The ink of the picture is 246 pixels wide and 222 pixels tall.
    expect(width / height).toBeGreaterThan(1.05);
    expect(width / height).toBeLessThan(1.17);
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

  it('keeps the slot between the wings horizontal and open to the left', () => {
    const { markup, viewBox } = renderIcon(IconSend);
    const points = pathPoints(pathOf(markup));
    const top = viewBox[1] ?? 0;
    const height = viewBox[3] ?? 24;
    const middleY = top + height / 2;
    // The nose of the slot is the left edge of the shape on the middle line.
    const slotNose = leftEdge(points, middleY);
    // A quarter of the way up the shape is the edge of the upper wing.
    const upperWing = leftEdge(points, top + height * 0.25);
    const lowerWing = leftEdge(points, top + height * 0.75);
    expect(slotNose).toBeGreaterThan(upperWing + 5);
    expect(slotNose).toBeGreaterThan(lowerWing + 5);
    // The slot is horizontal, it is the widest exactly on the middle line.
    expect(slotNose).toBeGreaterThan(leftEdge(points, middleY - 0.5) + 2);
    expect(slotNose).toBeGreaterThan(leftEdge(points, middleY + 0.5) + 2);
    // The wings of the arrow are mirror images.
    expect(Math.abs(upperWing - lowerWing)).toBeLessThan(0.2);
  });

  it('renders the arrow of the picture at the same pixel size', () => {
    const { markup, viewBox } = renderIcon(IconSend);
    const size = Number(/width="([\d.]+)"/.exec(markup)?.[1] ?? '0');
    const box = markupBBox(markup);
    const scale = size / (viewBox[3] ?? 24);
    const inkWidth = (box.maxX - box.minX) * scale;
    const inkHeight = (box.maxY - box.minY) * scale;
    expect(inkWidth).toBeGreaterThan(16.8);
    expect(inkWidth).toBeLessThan(17.4);
    expect(inkHeight).toBeGreaterThan(15.2);
    expect(inkHeight).toBeLessThan(15.7);
  });

  it('keeps the stop square filled and at the weight of the arrow', () => {
    const { markup, viewBox } = renderIcon(IconStop);
    expect(markup).toContain('fill="currentColor"');
    const size = Number(/width="([\d.]+)"/.exec(markup)?.[1] ?? '0');
    const box = markupBBox(markup);
    const scale = size / (viewBox[3] ?? 24);
    const side = (box.maxX - box.minX) * scale;
    expect(side).toBeGreaterThan(10.5);
    expect(side).toBeLessThan(11.5);
  });
});
