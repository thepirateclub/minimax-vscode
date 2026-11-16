import { describe, expect, it } from 'vitest';
import { groupToolSteps } from '../../src/ui/webview/toolSteps';
import type { UiMessage } from '../../src/ui/protocol';

function toolMessage(id: string): UiMessage {
  return {
    id,
    role: 'tool',
    tool: { id, name: 'read_file', input: { path: 'a.ts' } }
  };
}

function userMessage(id: string): UiMessage {
  return { id, role: 'user', text: 'do it' };
}

function assistantMessage(id: string): UiMessage {
  return { id, role: 'assistant', text: 'sure' };
}

describe('the grouping of the actions by step', () => {
  it('puts the actions of one request into one step', () => {
    const items = groupToolSteps([
      userMessage('u1'),
      assistantMessage('a1'),
      toolMessage('t1'),
      toolMessage('t2')
    ]);
    expect(items.length).toBe(3);
    expect(items[0]?.kind).toBe('message');
    expect(items[1]?.kind).toBe('message');
    const steps = items.filter((item) => item.kind === 'steps');
    expect(steps.length).toBe(1);
    expect(steps[0]?.kind === 'steps' ? steps[0].step.tools.length : 0).toBe(2);
  });

  it('starts a new step after the next request of the reader', () => {
    const items = groupToolSteps([
      userMessage('u1'),
      toolMessage('t1'),
      userMessage('u2'),
      toolMessage('t2')
    ]);
    const steps = items.filter((item) => item.kind === 'steps');
    expect(steps.length).toBe(2);
    expect(steps[0]?.kind === 'steps' ? steps[0].step.id : '').not.toBe(
      steps[1]?.kind === 'steps' ? steps[1].step.id : ''
    );
  });

  it('keeps the text of the model outside of the step', () => {
    const items = groupToolSteps([
      userMessage('u1'),
      toolMessage('t1'),
      assistantMessage('a1')
    ]);
    const steps = items.filter((item) => item.kind === 'steps');
    expect(steps.length).toBe(1);
    expect(items.filter((item) => item.kind === 'message').length).toBe(2);
  });
});
