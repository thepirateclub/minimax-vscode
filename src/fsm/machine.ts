// A finite state machine: the states, the events and the table of the
// transitions. The machine is data, the work is done by plain functions:
// one step by an event, the check of a step, the shortest path between two
// states and the transitive move along it. A step that the table does not
// know is a refusal with a reason, not a silent change of the state.

export interface Transition<S extends string, E extends string> {
  from: S | readonly S[];
  on: E;
  to: S;
}

export interface Machine<S extends string, E extends string> {
  readonly name: string;
  readonly initial: S;
  readonly transitions: readonly Transition<S, E>[];
}

export type StepResult<S extends string> =
  | { ok: true; state: S }
  | { ok: false; state: S; reason: string };

// The move from one state to another, the events of every step in order.
export type MoveResult<S extends string, E extends string> =
  | { ok: true; state: S; events: E[]; states: S[] }
  | { ok: false; state: S; reason: string };

export function defineMachine<S extends string, E extends string>(
  name: string,
  initial: S,
  transitions: readonly Transition<S, E>[]
): Machine<S, E> {
  return { name, initial, transitions };
}

function sources<S extends string>(from: S | readonly S[]): readonly S[] {
  return typeof from === 'string' ? [from as S] : (from as readonly S[]);
}

// The state after the event, or undefined when the table has no such step.
export function target<S extends string, E extends string>(
  machine: Machine<S, E>,
  state: S,
  event: E
): S | undefined {
  return machine.transitions.find((item) => item.on === event && sources(item.from).includes(state))?.to;
}

export function can<S extends string, E extends string>(machine: Machine<S, E>, state: S, event: E): boolean {
  return target(machine, state, event) !== undefined;
}

// One step of the machine by an event.
export function step<S extends string, E extends string>(
  machine: Machine<S, E>,
  state: S,
  event: E
): StepResult<S> {
  const next = target(machine, state, event);
  return next === undefined
    ? { ok: false, state, reason: machine.name + ': no transition from ' + state + ' on ' + event }
    : { ok: true, state: next };
}

// The steps of the machine leaving a state: the event and the state after it.
export function exits<S extends string, E extends string>(
  machine: Machine<S, E>,
  state: S
): Array<{ on: E; to: S }> {
  return machine.transitions
    .filter((item) => sources(item.from).includes(state))
    .map((item) => ({ on: item.on, to: item.to }));
}

// The shortest chain of events from one state to another, breadth first.
// The same state is an empty chain. Undefined: the target is out of reach.
export function path<S extends string, E extends string>(
  machine: Machine<S, E>,
  from: S,
  to: S
): E[] | undefined {
  if (from === to) {
    return [];
  }
  const came = new Map<S, { prev: S; on: E }>();
  const seen = new Set<S>([from]);
  const queue: S[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as S;
    for (const exit of exits(machine, current)) {
      if (seen.has(exit.to)) {
        continue;
      }
      seen.add(exit.to);
      came.set(exit.to, { prev: current, on: exit.on });
      if (exit.to === to) {
        const events: E[] = [];
        let cursor: S = to;
        while (cursor !== from) {
          const link = came.get(cursor) as { prev: S; on: E };
          events.unshift(link.on);
          cursor = link.prev;
        }
        return events;
      }
      queue.push(exit.to);
    }
  }
  return undefined;
}

// The transitive move: the machine walks the shortest path to the target,
// every step goes through the table, the states passed are named.
export function moveTo<S extends string, E extends string>(
  machine: Machine<S, E>,
  from: S,
  to: S
): MoveResult<S, E> {
  const events = path(machine, from, to);
  if (events === undefined) {
    return { ok: false, state: from, reason: machine.name + ': ' + to + ' is out of reach from ' + from };
  }
  return { ok: true, state: to, events, states: passedStates(machine, from, events) };
}

// The states the chain of events passes, the last one is the target.
export function run<S extends string, E extends string>(
  machine: Machine<S, E>,
  from: S,
  events: readonly E[]
): StepResult<S> {
  let state = from;
  for (const event of events) {
    const result = step(machine, state, event);
    if (!result.ok) {
      return result;
    }
    state = result.state;
  }
  return { ok: true, state };
}

function passedStates<S extends string, E extends string>(machine: Machine<S, E>, from: S, events: readonly E[]): S[] {
  const states: S[] = [];
  let state = from;
  for (const event of events) {
    state = target(machine, state, event) as S;
    states.push(state);
  }
  return states;
}
