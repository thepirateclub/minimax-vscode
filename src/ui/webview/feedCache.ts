import type { UiMessage } from '../protocol';
import { isSourceRead, sourcesOfReads, type CodeSource } from './codeSources';
import { hintOf, type CommandHint } from './commandHistory';
import { isFailure } from './failedRequests';
import { GROUP_FROM, speaks, type FeedItem, type ToolStep } from './toolCard';

// The lists of the feed are left folds over the messages. The stream changes
// only the tail of the chat: every flush made a fresh array and the lists
// were counted again from the first message. The cache keeps the state after
// every message and resumes the fold at the first message that changed, so a
// flush costs the changed tail. The results keep their identity while their
// content stays: the rows of the chat are memoized on them.
//
// The cache sees a change only as a new object: a message of the panel is
// never changed in place. `item.text += delta` would keep the object, the
// fold would not see the change and the feed would show the old text. Every
// update of the messages copies the message it changes (appendToAssistant,
// appendProgress, resetAssistant), test/unit/feed-cache.test.ts guards it.

// The index of the first message that is not the same object.
export function firstChange(prev: readonly UiMessage[], next: readonly UiMessage[]): number {
  const count = Math.min(prev.length, next.length);
  let index = 0;
  while (index < count && prev[index] === next[index]) {
    index++;
  }
  return index;
}

export interface ChatLists {
  sources: CodeSource[];
  failed: Set<string>;
  commandsById: Map<string, CommandHint | undefined>;
}

// The lists over the whole chat: sources of snippets, failed requests and
// the command before every message.
export function createChatLists(): (messages: readonly UiMessage[]) => ChatLists {
  let seen: readonly UiMessage[] = [];
  // The state after the message i.
  const requestAt: Array<string | undefined> = [];
  const failedAt: Array<string | undefined> = [];
  const lastHintAt: Array<CommandHint | undefined> = [];
  const isRead: boolean[] = [];
  const failCounts = new Map<string, number>();
  const commandsById = new Map<string, CommandHint | undefined>();
  let reads: UiMessage[] = [];
  let sources = sourcesOfReads([]);
  let failed = new Set<string>();

  return (messages) => {
    const from = firstChange(seen, messages);
    let readsDirty = false;
    let failDirty = false;
    // The tail that changed goes away with its traces.
    for (let i = seen.length - 1; i >= from; i--) {
      const gone = failedAt[i];
      if (gone !== undefined) {
        const left = (failCounts.get(gone) ?? 1) - 1;
        if (left === 0) {
          failCounts.delete(gone);
          failDirty = true;
        } else {
          failCounts.set(gone, left);
        }
      }
      if (isRead[i]) {
        reads.pop();
        readsDirty = true;
      }
      commandsById.delete(seen[i]!.id);
    }
    requestAt.length = failedAt.length = lastHintAt.length = isRead.length = from;
    let request = from > 0 ? requestAt[from - 1] : undefined;
    let last = from > 0 ? lastHintAt[from - 1] : undefined;
    for (let i = from; i < messages.length; i++) {
      const message = messages[i]!;
      commandsById.set(message.id, last);
      const hint = hintOf(message);
      if (hint) {
        last = hint;
      }
      let fail: string | undefined;
      if (message.role === 'user') {
        request = message.id;
      } else if (request !== undefined && isFailure(message)) {
        fail = request;
        const count = failCounts.get(request) ?? 0;
        failCounts.set(request, count + 1);
        failDirty ||= count === 0;
      }
      const read = isSourceRead(message);
      if (read) {
        reads.push(message);
        readsDirty = true;
      }
      requestAt.push(request);
      failedAt.push(fail);
      lastHintAt.push(last);
      isRead.push(read);
    }
    seen = messages;
    if (readsDirty) {
      reads = [...reads];
      sources = sourcesOfReads(reads);
    }
    if (failDirty) {
      const next = new Set(failCounts.keys());
      if (next.size !== failed.size || [...next].some((id) => !failed.has(id))) {
        failed = next;
      }
    }
    return { sources, failed, commandsById };
  };
}

// The feed of the shown messages: the steps of the actions and the messages
// in the order they came, as groupToolSteps counts it.
export function createFeed(): (messages: readonly UiMessage[]) => FeedItem[] {
  let seen: readonly UiMessage[] = [];
  const items: FeedItem[] = [];
  // After the message i: how many items stood, the open step and its size.
  const itemsAt: number[] = [];
  const stepAt: Array<ToolStep | undefined> = [];
  const toolsAt: number[] = [];
  const stepItemAt: number[] = [];
  const single = new WeakMap<UiMessage, FeedItem>();
  const expanded = new WeakMap<ToolStep, FeedItem[]>();
  let feed: FeedItem[] = [];
  // The size of the feed after the item j: the items before a change keep
  // their cards, the feed is rebuilt from the first item that changed.
  const feedAt: number[] = [];

  const itemOf = (message: UiMessage): FeedItem => {
    let item = single.get(message);
    if (!item) {
      item = { kind: 'message', message };
      single.set(message, item);
    }
    return item;
  };

  return (messages) => {
    const from = firstChange(seen, messages);
    if (from === seen.length && from === messages.length) {
      return feed;
    }
    items.length = from > 0 ? itemsAt[from - 1]! : 0;
    itemsAt.length = stepAt.length = toolsAt.length = stepItemAt.length = from;
    let stable = items.length;
    let step = from > 0 ? stepAt[from - 1] : undefined;
    // The place of the open step: a notice does not close the step, the
    // step is not always the last item.
    let stepItem = from > 0 ? stepItemAt[from - 1]! : -1;
    if (step) {
      stable = Math.min(stable, stepItem);
    }
    // The open step gets a fresh object only when a card joins it: the
    // earlier states keep the old one with its own size.
    // The old object also grew past this state in the earlier pass: it is
    // cut back at once, otherwise the cards of the dropped tail stay in it.
    const reopen = (): void => {
      step = { id: step!.id, tools: step!.tools.slice(0, toolsAt[from - 1]) };
      items[stepItem] = { kind: 'steps', step };
    };
    if (step && step.tools.length !== toolsAt[from - 1]) {
      reopen();
    } else if (step) {
      // A later pass put a later copy of the step in its place: the state
      // of this message names its own copy.
      const item = items[stepItem];
      if (item?.kind !== 'steps' || item.step !== step) {
        items[stepItem] = { kind: 'steps', step };
      }
    }
    const kept = step;
    const join = (message: UiMessage): void => {
      if (step && step === kept) {
        reopen();
      }
      step!.tools.push(message);
    };
    for (let i = from; i < messages.length; i++) {
      const message = messages[i]!;
      if (message.role === 'user' || (message.role === 'assistant' && !message.approval && speaks(message))) {
        step = undefined;
      }
      if (message.role === 'tool' && message.tool?.name === 'task') {
        step = undefined;
        items.push(itemOf(message));
      } else if (message.role === 'tool' && message.tool) {
        if (!step) {
          step = { id: message.id, tools: [] };
          stepItem = items.length;
          items.push({ kind: 'steps', step });
        }
        join(message);
      } else {
        items.push(itemOf(message));
      }
      itemsAt.push(items.length);
      stepAt.push(step);
      toolsAt.push(step?.tools.length ?? 0);
      stepItemAt.push(stepItem);
    }
    seen = messages;
    // The open step still grows: from its place on the feed is new.
    feed = feed.slice(0, stable > 0 ? feedAt[stable - 1]! : 0);
    feedAt.length = stable;
    for (let j = stable; j < items.length; j++) {
      const item = items[j]!;
      if (item.kind !== 'steps' || item.step.tools.length >= GROUP_FROM) {
        feed.push(item);
      } else {
        // A short step stands as plain cards. The open step still grows,
        // its cards are taken again.
        const cached = item.step === step ? undefined : expanded.get(item.step);
        const cards = cached ?? item.step.tools.map(itemOf);
        expanded.set(item.step, cards);
        feed.push(...cards);
      }
      feedAt.push(feed.length);
    }
    return feed;
  };
}
