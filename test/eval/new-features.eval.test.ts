import { describe, expect, it } from 'vitest';
import { MiniMaxApiError } from '../../src/api/errors';
import { chatToMarkdown } from '../../src/ui/chatExport';
import type { UiMessage } from '../../src/ui/protocol';
import { call, runScenario, say, type Step } from './harness';

// The step of a model that is not available: the request fails before a
// byte of the answer.
function unavailable(code: number): Step {
  return () => {
    throw new MiniMaxApiError('model not available', 500, code, false);
  };
}

describe('eval: the fallback model', () => {
  it('moves the turn to the fallback model on 2061 and names both models', async () => {
    const trace = await runScenario({
      files: {},
      prompt: 'Say hi',
      steps: [unavailable(2061), say('hi')],
      options: { maxRetries: 0, fallback: { model: 'MiniMax-M3', maxTokens: 1000 } }
    });
    expect(trace.result.stopReason).toBe('end_turn');
    expect(trace.model.requests.map((request) => request.model)).toEqual(['MiniMax-M3.1-Flash', 'MiniMax-M3']);
    expect(trace.events).toContainEqual({ type: 'model_fallback', from: 'MiniMax-M3.1-Flash', to: 'MiniMax-M3' });
  });

  it('does not hide a plan limit behind another model', async () => {
    await expect(
      runScenario({
        files: {},
        prompt: 'Say hi',
        steps: [unavailable(2062), say('never')],
        options: { maxRetries: 0, fallback: { model: 'MiniMax-M3', maxTokens: 1000 } }
      })
    ).rejects.toMatchObject({ code: 2062 });
  });
});

describe('eval: sub-agents of one answer', () => {
  it('run together and hand the results back in the order of the calls', async () => {
    let running = 0;
    let peak = 0;
    const trace = await runScenario({
      files: {},
      prompt: 'Explore three modules',
      steps: [
        call(
          { name: 'task', input: { prompt: 'a', delay: 40 } },
          { name: 'task', input: { prompt: 'b', delay: 10 } },
          { name: 'task', input: { prompt: 'c', delay: 20 } }
        ),
        (request) => {
          const last = request.messages[request.messages.length - 1]!;
          const order = last.content.map((block) => (block.type === 'tool_result' ? block.content : ''));
          if (order.join(',') !== 'report a,report b,report c') {
            throw new Error('the results came out of order: ' + order.join(','));
          }
          return say('done')(request);
        }
      ],
      tools: [
        {
          name: 'task',
          description: 'sub-agent',
          approval: 'never',
          sideEffect: true,
          inputSchema: { type: 'object', properties: {} },
          execute: async (input) => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, Number(input['delay'])));
            running -= 1;
            return { content: 'report ' + String(input['prompt']) };
          }
        }
      ]
    });
    expect(trace.result.stopReason).toBe('end_turn');
    expect(peak).toBe(3);
  });
});

describe('eval: the export of a chat', () => {
  it('keeps a diff and a thought with a closing tag readable', () => {
    const messages: UiMessage[] = [
      { id: 'u', role: 'user', text: 'Fix add' },
      { id: 'a', role: 'assistant', thinking: 'The tag </details> is text here.', text: 'Fixed.' },
      {
        id: 't',
        role: 'tool',
        tool: {
          id: 't',
          name: 'edit_file',
          input: { path: 'src/math.ts' },
          content: 'Edited src/math.ts',
          diff: { path: 'src/math.ts', lines: [{ type: 'remove', text: '  return a - b;' }, { type: 'add', text: '  return a + b;' }] }
        }
      } as UiMessage
    ];
    const markdown = chatToMarkdown({ title: 'Fix\nadd', updatedAt: 0, uiMessages: messages } as never);
    expect(markdown.startsWith('# Fix add\n')).toBe(true);
    expect(markdown.match(/<\/details>/g)).toHaveLength(1);
    expect(markdown).toContain('-  return a - b;');
    expect(markdown).toContain('+  return a + b;');
  });
});
