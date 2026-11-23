import type { MiniMaxController } from '../extension';
import type { RuntimeSession } from './runtime';

// How many messages wait in the queue of a chat.
const MAX_QUEUE_ITEMS = 30;
import type { UiSelection } from '../ui/protocol';
import { persist } from './sessions';
import { postFor } from './channel';

export function sendQueued(host: MiniMaxController, id: string): void {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  const index = runtime.queue.findIndex((item) => item.id === id);
  if (index === -1) {
    return;
  }
  const item = runtime.queue[index]!;
  if (item.state === 'sending') {
    return;
  }
  item.state = 'waiting';
  item.error = undefined;
  runtime.queue.splice(index, 1);
  runtime.queue.unshift(item);
  runtime.queuePaused = false;
  postQueue(host, runtime);
  void pumpQueue(host, runtime);
}


export function sendAllQueued(host: MiniMaxController): void {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  runtime.queuePaused = false;
  for (const item of runtime.queue) {
    if (item.state === 'error') {
      item.state = 'waiting';
      item.error = undefined;
    }
  }
  postQueue(host, runtime);
  void pumpQueue(host, runtime);
}


export function removeQueued(host: MiniMaxController, id: string): void {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  const index = runtime.queue.findIndex((item) => item.id === id);
  if (index === -1) {
    return;
  }
  if (runtime.queue[index]!.state === 'sending') {
    return;
  }
  runtime.queue.splice(index, 1);
  postQueue(host, runtime);
  persist(host, runtime);
}


export function enqueue(host: MiniMaxController, runtime: RuntimeSession,
  text: string,
  mentions: string[],
  selections: UiSelection[]): void {
  runtime.queue.push({
    id: host.nextId('q'),
    text,
    mentions,
    selections,
    state: 'waiting'
  });
  trimQueue(host, runtime);
  postQueue(host, runtime);
  persist(host, runtime);
}


export function trimQueue(_host: MiniMaxController, runtime: RuntimeSession): void {
  while (runtime.queue.length > MAX_QUEUE_ITEMS) {
    const index = runtime.queue.findIndex((item) => item.state === 'done');
    if (index === -1) {
      return;
    }
    runtime.queue.splice(index, 1);
  }
}


export function postQueue(host: MiniMaxController, runtime: RuntimeSession): void {
  postFor(host, runtime, {
    type: 'queue',
    items: runtime.queue.map((item) => ({
      id: item.id,
      text: item.text,
      state: item.state,
      error: item.error
    }))
  });
}


export async function pumpQueue(host: MiniMaxController, runtime: RuntimeSession): Promise<void> {
  if (runtime.busy || runtime.queuePaused) {
    return;
  }
  const next = runtime.queue.find((item) => item.state === 'waiting');
  if (!next) {
    return;
  }
  next.state = 'sending';
  postQueue(host, runtime);
  await host.runTurn(runtime, next.text, next.mentions, next.selections, next);
}

