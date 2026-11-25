import type { AgentState } from './protocol';
import { defineMachine, moveTo } from '../fsm/machine';
import type { MoveResult } from '../fsm/machine';

// The state of a chat as the panel and the status bar show it. The turn
// thinks, streams the answer, runs tools and ends idle or in an error. The
// host names the state it reaches, the machine walks there through the
// table: a tool right after the start passes thinking.

export type StatusEvent = 'think' | 'stream' | 'tool' | 'finish' | 'fail';

export const statusMachine = defineMachine<AgentState, StatusEvent>('status', 'idle', [
  { from: ['idle', 'streaming', 'tool', 'error'], on: 'think', to: 'thinking' },
  { from: ['thinking', 'tool'], on: 'stream', to: 'streaming' },
  { from: ['thinking', 'streaming'], on: 'tool', to: 'tool' },
  { from: ['thinking', 'streaming', 'tool', 'error'], on: 'finish', to: 'idle' },
  { from: ['idle', 'thinking', 'streaming', 'tool'], on: 'fail', to: 'error' }
]);

export function moveStatus(from: AgentState, to: AgentState): MoveResult<AgentState, StatusEvent> {
  return moveTo(statusMachine, from, to);
}
