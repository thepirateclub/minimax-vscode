import { describe, expect, it } from 'vitest';
import { groupToolSteps } from '../../src/ui/webview/toolCard';
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

function thinkingMessage(id: string): UiMessage {
  return { id, role: 'assistant', thinking: 'the model thinks' };
}

function emptyAssistantMessage(id: string): UiMessage {
  return { id, role: 'assistant', text: '' };
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

  // The group of the actions must not swallow the whole turn: the actions
  // that follow a thought or an answer are the next step of the work.
  it('closes the group of the actions at the thought of the model', () => {
    const items = groupToolSteps([
      userMessage('u1'),
      toolMessage('t1'),
      toolMessage('t2'),
      thinkingMessage('th1'),
      toolMessage('t3')
    ]);
    const steps = items.filter((item) => item.kind === 'steps');
    expect(steps.length).toBe(2);
    expect(steps[0]?.kind === 'steps' ? steps[0].step.tools.length : 0).toBe(2);
    expect(steps[1]?.kind === 'steps' ? steps[1].step.tools.length : 0).toBe(1);
  });

  it('closes the group of the actions at the answer of the model', () => {
    const items = groupToolSteps([
      userMessage('u1'),
      toolMessage('t1'),
      assistantMessage('a1'),
      toolMessage('t2')
    ]);
    const steps = items.filter((item) => item.kind === 'steps');
    expect(steps.length).toBe(2);
    expect(steps[0]?.kind === 'steps' ? steps[0].step.tools.length : 0).toBe(1);
    expect(steps[1]?.kind === 'steps' ? steps[1].step.tools.length : 0).toBe(1);
  });

  it('keeps the actions of one turn together when the model says nothing', () => {
    const items = groupToolSteps([
      userMessage('u1'),
      toolMessage('t1'),
      emptyAssistantMessage('a1'),
      toolMessage('t2')
    ]);
    const steps = items.filter((item) => item.kind === 'steps');
    expect(steps.length).toBe(1);
    expect(steps[0]?.kind === 'steps' ? steps[0].step.tools.length : 0).toBe(2);
  });
});

describe('the card of a sub-agent in the feed', () => {
  function taskMessage(id: string): UiMessage {
    return {
      id,
      role: 'tool',
      tool: { id, name: 'task', input: { description: 'Find the parser', role: 'explore' } }
    };
  }

  // The work of a sub-agent is a block of its own: its actions stand in its
  // card, the card does not hide in the group of the actions of the parent.
  it('stands outside of the group and splits it in two', () => {
    const items = groupToolSteps([
      userMessage('u1'),
      toolMessage('t1'),
      taskMessage('k1'),
      toolMessage('t2')
    ]);
    expect(items.map((item) => item.kind)).toEqual(['message', 'steps', 'message', 'steps']);
    const task = items[2];
    expect(task?.kind === 'message' ? task.message.id : '').toBe('k1');
    const second = items[3];
    expect(second?.kind === 'steps' ? second.step.id : '').toBe('t2');
  });

  it('stands alone when two sub-agents follow each other', () => {
    const items = groupToolSteps([taskMessage('k1'), taskMessage('k2')]);
    expect(items.map((item) => item.kind)).toEqual(['message', 'message']);
  });
});
