import { describe, expect, it } from 'vitest';
import { createGoalTools, formatGoal } from '../../src/tools/goal';
import type { GoalState } from '../../src/agent/state';
import type { ToolContext } from '../../src/tools/types';

const GOAL: GoalState = {
  objective: 'Rewrite the parser',
  tokenBudget: 12000,
  requestLimit: 10,
  secondsLimit: 300,
  status: 'active',
  used: { tokens: 4300, requests: 2, seconds: 65 }
};

function makeContext(goal?: GoalState): ToolContext {
  return {
    workspaceRoot: '/tmp/root',
    signal: new AbortController().signal,
    logger: { info: () => undefined, error: () => undefined },
    sessionState: goal ? { todos: [], goal } : { todos: [] }
  };
}

describe('the goal of the session', () => {
  it('shows the goal with its limits and its spend', () => {
    const text = formatGoal(GOAL);
    expect(text).toContain('Rewrite the parser');
    expect(text).toContain('12000 tokens');
    expect(text).toContain('10 requests');
    expect(text).toContain('300 seconds');
    expect(text).toContain('4300 tokens');
    expect(text).toContain('2 requests');
  });

  it('reads the goal of the session', async () => {
    const tools = createGoalTools();
    const get = tools.find((tool) => tool.name === 'get_goal');
    const result = await get!.execute({}, makeContext(GOAL));
    expect(result.content).toContain('Rewrite the parser');
    expect(result.isError).toBeUndefined();
  });

  it('says that there is no goal', async () => {
    const tools = createGoalTools();
    const get = tools.find((tool) => tool.name === 'get_goal');
    const result = await get!.execute({}, makeContext());
    expect(result.content.toLowerCase()).toContain('no goal');
  });

  it('marks the goal as done with a snapshot', async () => {
    const tools = createGoalTools();
    const update = tools.find((tool) => tool.name === 'update_goal');
    const result = await update!.execute(
      { status: 'complete', note: 'the parser is rewritten' },
      makeContext(GOAL)
    );
    expect(result.state).toEqual({
      kind: 'goal',
      status: 'complete',
      note: 'the parser is rewritten'
    });
    expect(result.isError).toBeUndefined();
  });

  it('refuses an unknown status', async () => {
    const tools = createGoalTools();
    const update = tools.find((tool) => tool.name === 'update_goal');
    const result = await update!.execute({ status: 'paused' }, makeContext(GOAL));
    expect(result.isError).toBe(true);
    expect(result.state).toBeUndefined();
  });

  it('refuses to change the limits of the goal', async () => {
    const tools = createGoalTools();
    const update = tools.find((tool) => tool.name === 'update_goal');
    const result = await update!.execute(
      { status: 'complete', tokenBudget: 999999 },
      makeContext(GOAL)
    );
    expect(result.isError).toBe(true);
    expect(result.state).toBeUndefined();
  });

  it('refuses every limit of the goal', async () => {
    const tools = createGoalTools();
    const update = tools.find((tool) => tool.name === 'update_goal');
    for (const key of ['tokenBudget', 'requestLimit', 'secondsLimit']) {
      const input: Record<string, unknown> = { status: 'complete' };
      input[key] = 999999;
      const result = await update!.execute(input, makeContext(GOAL));
      expect(result.isError).toBe(true);
      expect(result.state).toBeUndefined();
      expect(result.content).toContain(
        'The limits of the goal belong to the user, the model cannot change them.'
      );
    }
  });

  it('refuses an unknown key', async () => {
    const tools = createGoalTools();
    const update = tools.find((tool) => tool.name === 'update_goal');
    const result = await update!.execute(
      { status: 'complete', objective: 'a different goal' },
      makeContext(GOAL)
    );
    expect(result.isError).toBe(true);
    expect(result.state).toBeUndefined();
    expect(result.content).toContain('objective');
    expect(result.content).toContain('status');
    expect(result.content).toContain('note');
  });
});
