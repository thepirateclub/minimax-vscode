import { describe, expect, it } from 'vitest';
import { moveStatus } from '../../src/ui/statusMachine';
import { moveQueued } from '../../src/host/queueMachine';
import { voiceMachine } from '../../src/voice/controller';
import { path } from '../../src/fsm/machine';
import type { AgentState, QueuedMessage } from '../../src/ui/protocol';

const STATES: AgentState[] = ['idle', 'thinking', 'streaming', 'tool', 'error'];

describe('the machine of the status', () => {
  it('reaches every state from every state', () => {
    for (const from of STATES) {
      for (const to of STATES) {
        expect(moveStatus(from, to).ok, from + ' -> ' + to).toBe(true);
      }
    }
  });

  it('passes thinking on the way from idle to a tool', () => {
    expect(moveStatus('idle', 'tool')).toEqual({ ok: true, state: 'tool', events: ['think', 'tool'], states: ['thinking', 'tool'] });
  });
});

describe('the machine of the queue', () => {
  const item = (): QueuedMessage => ({ id: 'q', text: 't', mentions: [], selections: [], state: 'waiting' });

  it('walks a message from waiting to done', () => {
    const message = item();
    expect(moveQueued(message, 'send')).toBe(true);
    expect(moveQueued(message, 'sent')).toBe(true);
    expect(message.state).toBe('done');
  });

  it('keeps the reason with the failed state only', () => {
    const message = item();
    moveQueued(message, 'send');
    moveQueued(message, 'fail', 'no key');
    expect(message).toMatchObject({ state: 'error', error: 'no key' });
    moveQueued(message, 'retry');
    expect(message).toMatchObject({ state: 'waiting', error: undefined });
  });

  it('refuses a step the table does not know', () => {
    const message = item();
    expect(moveQueued(message, 'sent')).toBe(false);
    expect(message.state).toBe('waiting');
    moveQueued(message, 'send');
    expect(moveQueued(message, 'retry')).toBe(false);
  });
});

describe('the machine of the voice', () => {
  it('goes from idle through the recording back to idle', () => {
    expect(path(voiceMachine, 'idle', 'transcribing')).toEqual(['start', 'stop']);
    expect(path(voiceMachine, 'transcribing', 'idle')).toEqual(['done']);
  });
});
