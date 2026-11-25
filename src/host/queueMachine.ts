import type { QueuedMessage, QueueState } from '../ui/protocol';
import { defineMachine, step } from '../fsm/machine';

// The life of a message of the queue: it waits, goes out and ends sent or
// failed. A stopped turn puts it back to wait, the reader sends a failed
// or a sent one again.
export type QueueEvent = 'send' | 'sent' | 'fail' | 'stop' | 'retry';

export const queueMachine = defineMachine<QueueState, QueueEvent>('queue', 'waiting', [
  { from: 'waiting', on: 'send', to: 'sending' },
  { from: 'sending', on: 'sent', to: 'done' },
  { from: 'sending', on: 'fail', to: 'error' },
  { from: 'sending', on: 'stop', to: 'waiting' },
  { from: ['waiting', 'error', 'done'], on: 'retry', to: 'waiting' }
]);

// One step of a message of the queue. The reason of a failure lives with
// the failed state only. False: the table has no such step, nothing changes.
export function moveQueued(item: QueuedMessage, event: QueueEvent, error?: string): boolean {
  const result = step(queueMachine, item.state, event);
  if (!result.ok) {
    return false;
  }
  item.state = result.state;
  item.error = result.state === 'error' ? error : undefined;
  return true;
}
