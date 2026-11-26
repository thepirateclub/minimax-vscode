import type { MiniMaxController } from '../extension';
import type { RuntimeSession } from './runtime';
import type { UiSelection } from '../ui/protocol';
import { moveQueued } from './queueMachine';
export { moveQueued, queueMachine } from './queueMachine';
export type { QueueEvent } from './queueMachine';
import { persist } from './sessions';
import { postFor } from './channel';
import { runTurn } from './turn';
import { dropApprovalCards } from './approvals';

// How many messages wait in the queue of a chat.
const MAX_QUEUE_ITEMS = 30;

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
  if (!moveQueued(item, 'retry')) {
    return;
  }
  runtime.queue.splice(index, 1);
  runtime.queue.unshift(item);
  runtime.queuePaused = false;
  postQueue(host, runtime);
  if (runtime.busy) {
    // Send now does not wait for the turn: the turn stops, and its end
    // sends the message, which stands first in the queue.
    runtime.sendNow = true;
    runtime.agent?.stop();
    dropApprovalCards(host, runtime, false);
    return;
  }
  void pumpQueue(host, runtime);
}


export function sendAllQueued(host: MiniMaxController): void {
  const runtime = host.activeSession();
  if (!runtime) {
    return;
  }
  runtime.queuePaused = false;
  for (const item of runtime.queue.filter((queued) => queued.state === 'error')) {
    moveQueued(item, 'retry');
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
  // A message that goes out now belongs to the turn, it is not removed.
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
  if (runtime.busy || runtime.queuePaused || runtime.deleted) {
    return;
  }
  const next = runtime.queue.find((item) => item.state === 'waiting');
  if (!next) {
    return;
  }
  moveQueued(next, 'send');
  postQueue(host, runtime);
  await runTurn(host, runtime, next.text, next.mentions, next.selections, next);
}

