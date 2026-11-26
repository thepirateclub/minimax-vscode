import type { ToolRecord, Trace } from './harness';

// The checks of the behaviour of the agent. Each returns a list of the
// broken rules, an empty list is a pass: the scenario names what failed.

const EDITS = new Set(['write_file', 'edit_file']);

function pathOf(record: ToolRecord): string {
  return typeof record.input.path === 'string' ? record.input.path : '';
}

// Every edit of an existing file comes after a read of that file.
export function readsBeforeEdits(trace: Trace, existing: string[]): string[] {
  const read = new Set<string>();
  const broken: string[] = [];
  for (const record of trace.tools) {
    if (record.name === 'read_file') {
      read.add(pathOf(record));
    } else if (EDITS.has(record.name) && existing.includes(pathOf(record)) && !read.has(pathOf(record))) {
      broken.push(`${record.name} ${pathOf(record)} before read_file`);
    }
  }
  return broken;
}

// A failed edit is followed by a successful edit of the same file.
export function recoversFromFailedEdit(trace: Trace): string[] {
  const failed = trace.tools.findIndex((record) => record.name === 'edit_file' && record.isError);
  if (failed < 0) {
    return ['no failed edit_file in the trace'];
  }
  const path = pathOf(trace.tools[failed]!);
  const fixed = trace.tools.slice(failed + 1).some((record) => EDITS.has(record.name) && pathOf(record) === path && !record.isError);
  return fixed ? [] : [`no successful edit of ${path} after the failure`];
}

// No identical call runs more than `limit` times, refusals do not count.
export function noRunawayRepeats(trace: Trace, limit: number): string[] {
  const seen = new Map<string, number>();
  for (const record of trace.tools) {
    if (record.isError) {
      continue;
    }
    const key = `${record.name} ${JSON.stringify(record.input)}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > limit).map(([key, count]) => `${key} ran ${count} times`);
}

// Every refusal the model got is visible as a card too.
export function refusalsVisible(trace: Trace): string[] {
  const refusals = trace.model.requests
    .flatMap((request) => request.messages.slice(-1))
    .flatMap((message) => message.content)
    .filter((block) => block.type === 'tool_result' && block.is_error).length;
  const cards = trace.tools.filter((record) => record.isError).length;
  return cards >= refusals ? [] : [`${refusals} refusals sent to the model, ${cards} cards shown`];
}

export function stopsWith(trace: Trace, reason: string): string[] {
  return trace.result.stopReason === reason ? [] : [`stop reason ${trace.result.stopReason}, expected ${reason}`];
}

// Plan mode: no tool with a side effect is offered, runs or asks.
export function respectsPlanMode(trace: Trace): string[] {
  const broken: string[] = [];
  for (const request of trace.model.requests) {
    const offered = (request.tools ?? []).map((tool) => tool.name).filter((name) => EDITS.has(name));
    if (offered.length > 0) {
      broken.push(`plan mode offered ${offered.join(', ')}`);
    }
  }
  if (trace.approvals.length > 0) {
    broken.push(`plan mode asked ${trace.approvals.length} approvals`);
  }
  const ran = trace.tools.filter((record) => EDITS.has(record.name) && !record.isError);
  if (ran.length > 0) {
    broken.push(`plan mode ran ${ran.map((record) => record.name).join(', ')}`);
  }
  return broken;
}
