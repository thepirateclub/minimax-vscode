import type { ExtToWeb, UiMessage } from '../protocol';
import { STRINGS } from './strings';
import { text } from './value';

export interface ToolStep {
  // The id of the step, it is the id of the first card of it.
  id: string;
  // The cards of the step.
  tools: UiMessage[];
}

export type FeedItem =
  | { kind: 'message'; message: UiMessage }
  | { kind: 'steps'; step: ToolStep };

// The card of an action is open by default. The setting folds it and a long
// output stays folded too. A click of the reader wins over both, so the card
// follows the setting again only for the cards nobody touched.
export function cardOpen(
  collapsed: boolean,
  verbose: boolean,
  override: boolean | null
): boolean {
  return override ?? (!collapsed && !verbose);
}

// The result of the call goes into the last card with that id: the same id
// of a tool call can come back in a later turn, the card of the earlier turn
// keeps its own result. The rule lives in a module of its own, the panel
// is a React component and the tests of the panel run without a browser.
export function endTool(
  messages: UiMessage[],
  message: Extract<ExtToWeb, { type: 'tool_end' }>
): UiMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i]!;
    if (item.tool && item.tool.id === message.id) {
      next[i] = {
        ...item,
        tool: {
          ...item.tool,
          content: message.content,
          isError: message.isError,
          running: false,
          diff: message.diff
        }
      };
      return next;
    }
  }
  return next;
}

// The actions of the agent are grouped by step: a step is the work of one
// request of the reader. The cards of the step stand under one header, the
// header stays visible when the step is folded.
//
// The group ends at the thought or at the answer of the model: the actions
// that follow a thought are the next step of the work, not the tail of the
// step before it. The order of the chat reads as actions, thought, actions.
// The card of a sub-agent ends the group too and stands between the groups.
// A group needs more than three actions: a head over one or two cards only
// repeated them, and a chat of short steps turned into a list of heads.
export const GROUP_FROM = 4;

export function groupToolSteps(messages: UiMessage[]): FeedItem[] {
  return groupBySteps(messages).flatMap((item) =>
    item.kind === 'steps' && item.step.tools.length < GROUP_FROM
      ? item.step.tools.map((message): FeedItem => ({ kind: 'message', message }))
      : [item]
  );
}

// The groups before the threshold: the rules of the step, tested alone.
export function groupBySteps(messages: UiMessage[]): FeedItem[] {
  const items: FeedItem[] = [];
  let step: ToolStep | undefined;
  for (const message of messages) {
    // A new request of the reader starts a new step.
    if (message.role === 'user') {
      step = undefined;
    }
    // The thought or the answer of the model closes the group of the
    // actions: the next actions stand under a new head.
    if (message.role === 'assistant' && !message.approval && speaks(message)) {
      step = undefined;
    }
    // The card of a sub-agent is a block of its own: the actions of the
    // child stand inside it, and in the group of the parent it read as one
    // more action. It closes the group, the next actions start a new one.
    if (message.role === 'tool' && message.tool?.name === 'task') {
      step = undefined;
      items.push({ kind: 'message', message });
      continue;
    }
    if (message.role === 'tool' && message.tool) {
      if (!step) {
        // The id of the step is the id of its first card. A counter over the
        // shown slice moved when the older part of the chat came in front of
        // it: the step got a new React key and its fold state was lost.
        step = { id: message.id, tools: [] };
        items.push({ kind: 'steps', step });
      }
      step.tools.push(message);
      continue;
    }
    items.push({ kind: 'message', message });
  }
  return items;
}

// The message of the model says something: it has a thought or an answer.
function speaks(message: UiMessage): boolean {
  return (message.text?.length ?? 0) > 0 || (message.thinking?.length ?? 0) > 0;
}

// The arguments are shown as a short list, not as a json dump.
export function formatInput(input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const shown = text(value);
    if (shown.length === 0) {
      continue;
    }
    lines.push(key + ': ' + (shown.length > 200 ? shown.slice(0, 200) + '…' : shown));
  }
  return lines.join('\n');
}

// The question of an approval names the action in the words of the card of
// the action, not the name of the tool: "Write src/app.ts?", not
// "Run write_file?".
export function approvalTitle(name: string, input: Record<string, unknown>): string {
  const path = text(input['path']);
  if (name === 'write_file' && path.length > 0) {
    return STRINGS.toolWrite + ' ' + path + '?';
  }
  if (name === 'edit_file' && path.length > 0) {
    return STRINGS.toolEdit + ' ' + path + '?';
  }
  if (name === 'run_terminal') {
    return STRINGS.approveCommand;
  }
  if (name === 'git_stage') {
    const paths = Array.isArray(input['paths'])
      ? input['paths'].filter((item): item is string => typeof item === 'string')
      : [];
    if (paths.length > 0) {
      const verb = input['unstage'] === true ? STRINGS.toolGitUnstage : STRINGS.toolGitStage;
      return verb + ' ' + paths.join(', ') + '?';
    }
  }
  if (name === 'git_commit') {
    const message = text(input['message']);
    if (message.length > 0) {
      return STRINGS.toolGitCommit + ' ' + message + '?';
    }
  }
  if (name === 'git_branch_create') {
    const branch = text(input['name']);
    if (branch.length > 0) {
      return STRINGS.toolGitBranchCreate + ' ' + branch + '?';
    }
  }
  if (name === 'git_checkout') {
    const ref = text(input['ref']);
    if (ref.length > 0) {
      return STRINGS.toolGitCheckout + ' ' + ref + '?';
    }
  }
  return STRINGS.approveTool + ' ' + name + '?';
}
