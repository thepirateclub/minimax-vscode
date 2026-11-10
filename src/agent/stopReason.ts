import type { StopReason } from '../api/types';

export interface StopNotice {
  message: string;
  kind: 'info' | 'warn' | 'error';
}

// Why the work of the agent ended. A turn that ends with the answer of the
// model needs no notice, every other reason must be named, otherwise the
// reader sees a silent stop.
export function stopNotice(
  stopReason: StopReason,
  maxIterations: number
): StopNotice | undefined {
  if (stopReason === 'end_turn' || stopReason === 'tool_use') {
    return undefined;
  }
  if (stopReason === 'max_iterations') {
    return {
      message:
        'The agent stopped after ' +
        maxIterations +
        ' iterations, the limit of the settings. The task is not finished, repeat the request or raise the limit.',
      kind: 'error'
    };
  }
  if (stopReason === 'max_tokens') {
    return {
      message:
        'The answer was cut, the model reached the limit of tokens for one reply.',
      kind: 'warn'
    };
  }
  return {
    message: 'The model stopped at a stop sequence.',
    kind: 'warn'
  };
}

// The request was stopped by the user, it is not a failure of the server.
export function isAbortMessage(message: string): boolean {
  return /abort/i.test(message);
}
