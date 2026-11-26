import { describe, expect, it } from 'vitest';
import { commandHints } from '../../src/ui/webview/commandHistory';
import type { UiMessage } from '../../src/ui/protocol';

// The row of a message is memoized: the hint must keep its object while the
// card of the command does not change, the stream redrew every row.
describe('commandHints', () => {
  it('keeps the same object for the same card', () => {
    const card = {
      id: 't1',
      role: 'tool',
      tool: { id: 'x', name: 'run_terminal', input: { command: 'npm test' }, content: 'ok' }
    } as unknown as UiMessage;
    const answer = { id: 'a1', role: 'assistant', text: 'a' } as UiMessage;
    const first = commandHints([card, answer]);
    const second = commandHints([card, { ...answer, text: 'ab' }]);
    expect(first[1]).toEqual({ command: 'npm test', output: 'ok' });
    expect(second[1]).toBe(first[1]);
  });
});
