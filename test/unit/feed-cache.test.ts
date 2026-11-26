import { describe, expect, it } from 'vitest';
import type { UiMessage } from '../../src/ui/protocol';
import { collectFileSources } from '../../src/ui/webview/codeBlock';
import { commandHints } from '../../src/ui/webview/commandHistory';
import { failedRequests } from '../../src/ui/webview/failedRequests';
import { createChatLists, createFeed } from '../../src/ui/webview/feedCache';
import { groupToolSteps } from '../../src/ui/webview/toolCard';

let counter = 0;
function make(kind: number): UiMessage {
  const id = 'm' + counter++;
  switch (kind % 7) {
    case 0:
      return { id, role: 'user', text: 'ask ' + id };
    case 1:
      return { id, role: 'assistant', text: 'answer ' + id };
    case 2:
      return { id, role: 'assistant', text: '' };
    case 3:
      return { id, role: 'notice', kind: 'error', text: 'fail' } as UiMessage;
    case 4:
      return { id, role: 'tool', tool: { id, name: 'run_terminal', input: { command: 'npm test' }, content: 'ok', isError: kind % 2 === 0 } } as UiMessage;
    case 5:
      return { id, role: 'tool', tool: { id, name: 'read_file', input: { path: 'a.ts' }, content: '1\tconst a = 1;' } } as UiMessage;
    default:
      return { id, role: 'tool', tool: { id, name: 'task', input: {}, content: 'done' } } as UiMessage;
  }
}

// A seeded random walk: the tests repeat.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe('the feed cache', () => {
  it('counts the same lists as the full fold after any change of the chat', () => {
    for (let seed = 1; seed <= 20; seed++) {
      walk(seed);
    }
  });

  function walk(seed: number): void {
    const next = random(seed);
    const lists = createChatLists();
    const feed = createFeed();
    let messages: UiMessage[] = [];
    for (let round = 0; round < 300; round++) {
      const roll = next();
      messages = [...messages];
      if (roll < 0.5 || messages.length === 0) {
        messages.push(make(Math.floor(next() * 14)));
      } else if (roll < 0.75) {
        // The stream: the last message gets a fresh object.
        const last = messages[messages.length - 1]!;
        messages[messages.length - 1] = { ...last, text: (last.text ?? '') + 'x' };
      } else if (roll < 0.9) {
        messages.splice(Math.floor(next() * messages.length));
      } else {
        messages[Math.floor(next() * messages.length)] = make(Math.floor(next() * 14));
      }
      const got = lists(messages);
      expect([...got.failed].sort()).toEqual([...failedRequests(messages)].sort());
      const hints = commandHints(messages);
      messages.forEach((message, index) => expect(got.commandsById.get(message.id)).toBe(hints[index]));
      expect(got.sources).toEqual(collectFileSources(messages));
      expect(feed(messages)).toEqual(groupToolSteps(messages));
    }
  }

  it('keeps the lists and the closed items while the answer streams', () => {
    const lists = createChatLists();
    const feed = createFeed();
    const base = [0, 5, 3, 4, 4, 4, 4, 1].map(make);
    const first = lists(base);
    const firstFeed = feed(base);
    const streamed = [...base.slice(0, -1), { ...base[base.length - 1]!, text: 'more' }];
    const second = lists(streamed);
    const secondFeed = feed(streamed);
    expect(second.sources).toBe(first.sources);
    expect(second.failed).toBe(first.failed);
    expect(secondFeed.slice(0, -1)).toEqual(firstFeed.slice(0, -1));
    secondFeed.slice(0, -1).forEach((item, index) => expect(item).toBe(firstFeed[index]));
  });
});
