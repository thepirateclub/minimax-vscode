import { describe, expect, it } from 'vitest';
import { can, defineMachine, exits, moveTo, path, run, step } from '../../src/fsm/machine';

type S = 'a' | 'b' | 'c' | 'd';
type E = 'go' | 'jump' | 'back';

const machine = defineMachine<S, E>('test', 'a', [
  { from: 'a', on: 'go', to: 'b' },
  { from: 'b', on: 'go', to: 'c' },
  { from: ['b', 'c'], on: 'back', to: 'a' },
  { from: 'c', on: 'jump', to: 'd' }
]);

describe('the state machine', () => {
  it('takes a step of the table and refuses an unknown one with a reason', () => {
    expect(step(machine, 'a', 'go')).toEqual({ ok: true, state: 'b' });
    const refused = step(machine, 'a', 'jump');
    expect(refused.ok).toBe(false);
    expect(refused.state).toBe('a');
    expect(can(machine, 'c', 'back')).toBe(true);
  });

  it('lists the steps that leave a state', () => {
    expect(exits(machine, 'b')).toEqual([{ on: 'go', to: 'c' }, { on: 'back', to: 'a' }]);
  });

  it('finds the shortest path and walks it transitively', () => {
    expect(path(machine, 'a', 'd')).toEqual(['go', 'go', 'jump']);
    expect(path(machine, 'c', 'b')).toEqual(['back', 'go']);
    expect(path(machine, 'a', 'a')).toEqual([]);
    expect(moveTo(machine, 'a', 'd')).toEqual({ ok: true, state: 'd', events: ['go', 'go', 'jump'], states: ['b', 'c', 'd'] });
  });

  it('refuses a target out of reach', () => {
    expect(path(machine, 'd', 'a')).toBeUndefined();
    expect(moveTo(machine, 'd', 'a').ok).toBe(false);
  });

  it('runs a chain of events and stops on the first refused one', () => {
    expect(run(machine, 'a', ['go', 'go'])).toEqual({ ok: true, state: 'c' });
    const broken = run(machine, 'a', ['go', 'jump']);
    expect(broken.ok).toBe(false);
    expect(broken.state).toBe('b');
  });
});
