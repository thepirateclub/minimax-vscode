// The timeline of a group of actions: every card is a point on the guide
// line, the head of the group names when the work started and when it
// ended. The logic lives without React, the tests run in node.

import type { UiMessage } from '../protocol';
import { formatStamp } from '../format';

export type TimelineState = 'running' | 'failed' | 'done';

export function timelineState(message: UiMessage): TimelineState {
  const tool = message.tool;
  if (tool?.running) {
    return 'running';
  }
  return tool?.isError ? 'failed' : 'done';
}

export interface Span {
  start: number;
  // Absent while an action of the group still runs.
  end: number | undefined;
}

// The start of the first action and the end of the last one. The end of an
// action is its start and its duration; a group of old chats has no moments.
export function stepSpan(tools: readonly UiMessage[]): Span | undefined {
  let start: number | undefined;
  let end: number | undefined;
  let running = false;
  for (const message of tools) {
    if (message.at === undefined) {
      continue;
    }
    start = start === undefined ? message.at : Math.min(start, message.at);
    if (message.tool?.running) {
      running = true;
      continue;
    }
    const finished = message.at + (message.tool?.durationMs ?? 0);
    end = end === undefined ? finished : Math.max(end, finished);
  }
  if (start === undefined) {
    return undefined;
  }
  return { start, end: running ? undefined : end };
}

// `14:02–14:05` within one day, both moments in full across the days, the
// start and a dash while the group still runs.
export function formatSpan(span: Span, now: number = Date.now()): string {
  const start = formatStamp(span.start, now);
  if (span.end === undefined) {
    return start + '–…';
  }
  const end = formatStamp(span.end, now);
  if (new Date(span.start).toDateString() === new Date(span.end).toDateString()) {
    const time = end.slice(end.lastIndexOf(' ') + 1);
    return start === end || start.endsWith(time) ? start : start + '–' + time;
  }
  return start + ' – ' + end;
}
