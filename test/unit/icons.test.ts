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

// The tip of the plane is the point with the largest x, the two edges
// that meet there have to form a right angle.
function tipAngle(markup: string): number {
  const outline = /<path d="([^"]+)"/.exec(markup)?.[1] ?? '';
  const numbers = (outline.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const points: Array<[number, number]> = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push([numbers[i] ?? 0, numbers[i + 1] ?? 0]);
  }
  if (points.length < 3) {
    return Number.NaN;
  }
  let tip = 0;
  for (let i = 1; i < points.length; i++) {
    if ((points[i]?.[0] ?? 0) > (points[tip]?.[0] ?? 0)) {
      tip = i;
    }
  }
  const head = points[tip]!;
  const previous = points[(tip - 1 + points.length) % points.length]!;
  const next = points[(tip + 1) % points.length]!;
  const a = [previous[0] - head[0], previous[1] - head[1]];
  const b = [next[0] - head[0], next[1] - head[1]];
  const dot = (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0);
  const len = Math.hypot(a[0] ?? 0, a[1] ?? 0) * Math.hypot(b[0] ?? 0, b[1] ?? 0);
  return (Math.acos(Math.min(1, Math.max(-1, dot / len))) * 180) / Math.PI;
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

  it('keeps a right angle at the tip of the send icon', () => {
    const { markup } = renderIcon(IconSend);
    const angle = tipAngle(markup);
    expect(Number.isFinite(angle)).toBe(true);
    expect(Math.abs(angle - 90)).toBeLessThan(0.5);
  });

  it('keeps the silhouette of the send icon from the reference', () => {
    const { markup } = renderIcon(IconSend);
    const paths = [...markup.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1] ?? '');
    expect(paths).toHaveLength(2);
    // The plane is a closed contour plus a fold that runs from the tail to the nose.
    expect(paths[0]).toMatch(/z$/i);
    const box = markupBBox(markup);
    const ratio = (box.maxY - box.minY) / (box.maxX - box.minX);
    expect(ratio).toBeGreaterThan(1.2);
    expect(ratio).toBeLessThan(1.5);
    const xs = (d: string): number[] =>
      (d.match(/-?\d*\.?\d+/g) ?? []).map(Number).filter((_, index) => index % 2 === 0);
    const nose = Math.max(...xs(paths[0] ?? ''));
    const foldEnd = Math.max(...xs(paths[1] ?? ''));
    expect(Math.abs(nose - foldEnd)).toBeLessThan(0.2);
  });

  // The picture the icon was taken from: the ink of the plane is 16.9 pixels
  // tall and 12.7 pixels wide, the button has to show the same glyph.
  it('renders the send icon of the reference at the same pixel size', () => {
    const { markup, viewBox } = renderIcon(IconSend);
    const size = Number(/width="([\d.]+)"/.exec(markup)?.[1] ?? '0');
    const stroke = Number(/stroke-width="([\d.]+)"/.exec(markup)?.[1] ?? '0');
    const box = markupBBox(markup);
    const scale = size / (viewBox[3] ?? 24);
    const inkHeight = (box.maxY - box.minY + stroke) * scale;
    const inkWidth = (box.maxX - box.minX + stroke) * scale;
    expect(inkHeight).toBeGreaterThan(16.5);
    expect(inkHeight).toBeLessThan(17.5);
    expect(inkWidth).toBeGreaterThan(12.5);
    expect(inkWidth).toBeLessThan(13.5);
  });

  // The square of the stop button keeps the weight of the plane, so the
  // button does not shrink when the turn starts.
  it('keeps the stop square at the weight of the plane', () => {
    const { markup, viewBox } = renderIcon(IconStop);
    const size = Number(/width="([\d.]+)"/.exec(markup)?.[1] ?? '0');
    const stroke = Number(/stroke-width="([\d.]+)"/.exec(markup)?.[1] ?? '0');
    const box = markupBBox(markup);
    const scale = size / (viewBox[3] ?? 24);
    const outer = (box.maxX - box.minX + stroke) * scale;
    expect(outer).toBeGreaterThan(12.5);
    expect(outer).toBeLessThan(13.5);
  });

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
