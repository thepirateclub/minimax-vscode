import { describe, expect, it } from 'vitest';
import { formatSpan, stepSpan, timelineState } from '../../src/ui/webview/timeline';
import type { UiMessage } from '../../src/ui/protocol';

function card(at: number | undefined, durationMs: number, extra: { running?: boolean; isError?: boolean } = {}): UiMessage {
  return {
    id: String(at),
    role: 'tool',
    tool: { id: String(at), name: 'read_file', input: {}, durationMs, ...extra },
    ...(at !== undefined ? { at } : {})
  };
}

// The group of actions is a timeline: every card is a point on the line,
// the head names when the work started and ended.
describe('the timeline of a group', () => {
  const now = new Date(2026, 10, 25, 18, 0).getTime();
  const at = (h: number, m: number, day = 25) => new Date(2026, 10, day, h, m).getTime();

  it('colors a point by the state of the action', () => {
    expect(timelineState(card(1, 0, { running: true }))).toBe('running');
    expect(timelineState(card(1, 0, { isError: true }))).toBe('failed');
    expect(timelineState(card(1, 0))).toBe('done');
  });

  it('spans from the first start to the last end', () => {
    const span = stepSpan([card(at(14, 2), 1000), card(at(14, 4), 60_000)])!;
    expect(span).toEqual({ start: at(14, 2), end: at(14, 5) });
    expect(formatSpan(span, now)).toBe('14:02–14:05');
  });

  it('names one moment when the group took less than a minute', () => {
    expect(formatSpan({ start: at(14, 2), end: at(14, 2) + 5000 }, now)).toBe('14:02');
  });

  it('gives the dates for another day and for a span across the days', () => {
    expect(formatSpan({ start: at(14, 2, 24), end: at(14, 9, 24) }, now)).toBe('24 Nov, 14:02–14:09');
    expect(formatSpan({ start: at(23, 50, 24), end: at(0, 10) }, now)).toBe('24 Nov, 23:50 – 00:10');
  });

  it('leaves the end open while an action runs and has no span for an old chat', () => {
    const span = stepSpan([card(at(14, 2), 1000), card(at(14, 3), 0, { running: true })])!;
    expect(formatSpan(span, now)).toBe('14:02–…');
    expect(stepSpan([card(undefined, 10)])).toBeUndefined();
  });
});
