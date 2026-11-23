import { describe, expect, it } from 'vitest';
import type { UiMessage } from '../../src/ui/protocol';
import { endTool } from '../../src/ui/webview/toolCard';

describe('the result of a tool call in the panel', () => {
  it('goes into the last card with that id', () => {
    const messages: UiMessage[] = [
      {
        id: 'm1',
        role: 'tool',
        tool: { id: 'toolu_1', name: 'write_file', input: {}, content: 'Wrote one.txt' }
      },
      {
        id: 'm2',
        role: 'tool',
        tool: { id: 'toolu_1', name: 'write_file', input: {}, content: 'Wrote two.txt' }
      }
    ];
    const next = endTool(messages, {
      type: 'tool_end',
      id: 'toolu_1',
      name: 'write_file',
      content: 'Wrote three.txt',
      isError: false
    });
    // The card of the earlier turn keeps its own result.
    expect(next[0]?.tool?.content).toBe('Wrote one.txt');
    expect(next[1]?.tool?.content).toBe('Wrote three.txt');
  });

  it('leaves the cards of the other calls alone', () => {
    const messages: UiMessage[] = [
      {
        id: 'm1',
        role: 'tool',
        tool: { id: 'toolu_1', name: 'write_file', input: {}, content: 'Wrote one.txt' }
      },
      {
        id: 'm2',
        role: 'tool',
        tool: { id: 'toolu_2', name: 'write_file', input: {}, content: 'Wrote two.txt' }
      }
    ];
    const next = endTool(messages, {
      type: 'tool_end',
      id: 'toolu_1',
      name: 'write_file',
      content: 'Wrote again.txt',
      isError: false
    });
    expect(next[0]?.tool?.content).toBe('Wrote again.txt');
    expect(next[1]?.tool?.content).toBe('Wrote two.txt');
  });

  it('keeps the list as it is when there is no card with that id', () => {
    const messages: UiMessage[] = [
      {
        id: 'm1',
        role: 'tool',
        tool: { id: 'toolu_1', name: 'write_file', input: {}, content: 'Wrote one.txt' }
      }
    ];
    const next = endTool(messages, {
      type: 'tool_end',
      id: 'toolu_9',
      name: 'write_file',
      content: 'Wrote nine.txt',
      isError: false
    });
    expect(next).toEqual(messages);
  });
});
