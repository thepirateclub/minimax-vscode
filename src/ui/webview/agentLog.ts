// The journal of a sub-agent comes as lines (src/host/child.ts): the start
// of an action is a json `{"tool": name, "input": {...}}`, its end is
// `name done` or `name failed`, the lines of its diff start with `+ ` or
// `- `. The chats saved before the json start with `name target`, the
// panel reads both forms into rows.

export type AgentLogState = 'running' | 'done' | 'failed';

export interface AgentLogRow {
  // The name of the tool, empty for an error of the child.
  name: string;
  target: string;
  // The input of the action without its payload, absent in an old chat.
  input?: Record<string, unknown>;
  state: AgentLogState;
  added: number;
  removed: number;
}

export function parseAgentLog(lines: readonly string[]): AgentLogRow[] {
  const rows: AgentLogRow[] = [];
  let open: AgentLogRow | undefined;
  let last: AgentLogRow | undefined;
  for (const line of lines) {
    if (line.startsWith('error: ')) {
      rows.push({ name: '', target: line.slice(7), state: 'failed', added: 0, removed: 0 });
      continue;
    }
    // The lines of a diff belong to the action that has just ended.
    if (last && (line.startsWith('+ ') || line.startsWith('- '))) {
      if (line.startsWith('+ ')) {
        last.added += 1;
      } else {
        last.removed += 1;
      }
      continue;
    }
    const start = parseStart(line);
    if (start) {
      open = { name: start.tool, target: '', input: start.input, state: 'running', added: 0, removed: 0 };
      last = undefined;
      rows.push(open);
      continue;
    }
    const space = line.indexOf(' ');
    const name = space === -1 ? line : line.slice(0, space);
    const rest = space === -1 ? '' : line.slice(space + 1);
    // An end line closes the open action of the same tool, otherwise the
    // word is the target of a new action (a file can be named done).
    if (open && open.name === name && (rest === 'done' || rest === 'failed')) {
      open.state = rest;
      last = open;
      open = undefined;
      continue;
    }
    open = { name, target: rest, state: 'running', added: 0, removed: 0 };
    last = undefined;
    rows.push(open);
  }
  return rows;
}

function parseStart(line: string): { tool: string; input: Record<string, unknown> } | undefined {
  if (!line.startsWith('{')) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(line);
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const record = value as Record<string, unknown>;
    const tool = record['tool'];
    const input = record['input'];
    if (typeof tool !== 'string' || typeof input !== 'object' || input === null || Array.isArray(input)) {
      return undefined;
    }
    // The check above makes the input a plain object of the json.
    return { tool, input: input as Record<string, unknown> };
  } catch {
    return undefined;
  }
}
