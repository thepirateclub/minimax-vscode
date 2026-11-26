// The check of the project after a turn that changed files: the command of
// the reader (tests, types, lint) runs, a failure goes back to the agent as
// the next request. The rounds are bounded: an agent that cannot fix the
// build must not burn the plan in a loop.
export interface VerifyState {
  command: string;
  // The turn wrote files: the backups of the chat grew since its start.
  changed: boolean;
  stopped: boolean;
  failed: boolean;
  mode: string;
  // The automatic rounds in a row, the request of the reader resets it.
  round: number;
  maxRounds: number;
}

export function shouldVerify(state: VerifyState): boolean {
  return (
    state.command.trim().length > 0 &&
    state.mode === 'code' &&
    state.changed &&
    !state.stopped &&
    !state.failed
  );
}

export function canFixAgain(state: Pick<VerifyState, 'round' | 'maxRounds'>): boolean {
  return state.round < state.maxRounds;
}

// The output of a failed check is long: its tail holds the errors.
const MAX_OUTPUT = 6000;

export function verifyPrompt(command: string, output: string): string {
  const tail = output.length > MAX_OUTPUT ? '...\n' + output.slice(-MAX_OUTPUT) : output;
  return (
    'The project check `' + command + '` failed after your changes. Fix the cause of the failures, ' +
    'do not weaken or skip the tests. The output of the check:\n\n```\n' + tail + '\n```'
  );
}

// The exit code from the last line of run_terminal: `[exit code N]`.
export function exitCodeOf(output: string): number | undefined {
  const match = /\[exit code (\d+)\]\s*$/.exec(output);
  return match ? Number(match[1]) : undefined;
}
