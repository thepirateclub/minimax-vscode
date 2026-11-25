import { describe, expect, it } from 'vitest';
import { clearOldToolResults, KEEP_RECENT_RESULTS } from '../../src/api/clearResults';
import type { AnthropicMessage } from '../../src/api/types';
import { FakeClient, makeAgent, textResponse } from '../helpers/agentFixture';

const LONG = 'x'.repeat(2000);

// One call of read_file and its result, the pair of the protocol.
function pair(index: number, content = LONG): AnthropicMessage[] {
  return [
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'c' + index, name: 'read_file', input: { path: 'f' + index + '.ts' } }]
    },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c' + index, content }] }
  ];
}

function results(messages: AnthropicMessage[]): string[] {
  return messages.flatMap((message) =>
    message.content.flatMap((block) => (block.type === 'tool_result' ? [block.content] : []))
  );
}

// The old results of the tools fill the window of the model, the model has
// moved on from them. The request keeps the last results whole and puts a
// stub in place of the older ones: MiniMax has no prompt cache, the stub
// breaks nothing and saves the tokens at once.
describe('clearOldToolResults', () => {
  it('keeps the recent results whole and stubs the older long ones', () => {
    const history = Array.from({ length: KEEP_RECENT_RESULTS + 2 }, (_, i) => pair(i)).flat();
    const shown = results(clearOldToolResults(history));
    expect(shown.slice(2).every((content) => content === LONG)).toBe(true);
    expect(shown[0]).toBe(
      '[The old result of read_file f0.ts is cleared, 2000 characters. Call the tool again if you need it, and keep what you found with note_write before it is cleared.]'
    );
    expect(shown[1]).toContain('read_file f1.ts');
  });

  it('keeps a short result, the stub would not save anything', () => {
    const history = Array.from({ length: KEEP_RECENT_RESULTS + 1 }, (_, i) => pair(i, 'ok')).flat();
    expect(results(clearOldToolResults(history)).every((content) => content === 'ok')).toBe(true);
  });

  it('keeps an error whole, the model learns from it', () => {
    const history = Array.from({ length: KEEP_RECENT_RESULTS + 1 }, (_, i) => pair(i)).flat();
    const first = history[1]!.content[0]!;
    if (first.type === 'tool_result') {
      first.is_error = true;
    }
    expect(results(clearOldToolResults(history))[0]).toBe(LONG);
  });

  it('does not change the history it gets, the session keeps the whole text', () => {
    const history = Array.from({ length: KEEP_RECENT_RESULTS + 1 }, (_, i) => pair(i)).flat();
    clearOldToolResults(history);
    expect(results(history).every((content) => content === LONG)).toBe(true);
  });

  it('keeps the pairs of the calls and the results and the other blocks', () => {
    const history = Array.from({ length: KEEP_RECENT_RESULTS + 1 }, (_, i) => pair(i)).flat();
    const shown = clearOldToolResults(history);
    expect(shown.length).toBe(history.length);
    expect(shown[0]).toBe(history[0]);
    const block = shown[1]!.content[0]!;
    expect(block.type === 'tool_result' && block.tool_use_id).toBe('c0');
  });
});

describe('the request of the agent', () => {
  it('sends the cleared copy and keeps the whole history in the result', async () => {
    const history = Array.from({ length: KEEP_RECENT_RESULTS + 1 }, (_, i) => pair(i)).flat();
    const client = new FakeClient([textResponse('ok')]);
    const { agent } = makeAgent(client);
    const result = await agent.run('next', history);
    expect(results(client.requests[0]!.messages)[0]).toContain('is cleared');
    expect(results(result.messages)[0]).toBe(LONG);
  });
});
