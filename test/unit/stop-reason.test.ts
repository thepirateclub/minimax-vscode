import { describe, expect, it } from 'vitest';
import { isAbortMessage, stopNotice } from '../../src/agent/stopReason';

describe('the reason of the stop', () => {
  it('says nothing when the model answered', () => {
    expect(stopNotice('end_turn', 40)).toBeUndefined();
    expect(stopNotice('tool_use', 40)).toBeUndefined();
  });

  it('names the limit of the iterations', () => {
    const notice = stopNotice('max_iterations', 40);
    expect(notice?.kind).toBe('error');
    expect(notice?.message).toContain('40');
    expect(notice?.message.toLowerCase()).toContain('iteration');
  });

  it('names the limit of the tokens', () => {
    const notice = stopNotice('max_tokens', 40);
    expect(notice?.kind).toBe('warn');
    expect(notice?.message.toLowerCase()).toContain('token');
  });

  it('knows a request that the user stopped', () => {
    expect(
      isAbortMessage('Network error while contacting MiniMax: This operation was aborted')
    ).toBe(true);
    expect(isAbortMessage('the model refused the request')).toBe(false);
  });

  it('names the budget of the goal', () => {
    const notice = stopNotice('goal_limit', 40, {
      objective: 'Rewrite the parser',
      status: 'active',
      used: { tokens: 12000, requests: 2, seconds: 10 }
    });
    expect(notice?.kind).toBe('warn');
    expect(notice?.message).toContain('Rewrite the parser');
    expect(notice?.message.toLowerCase()).toContain('budget');
  });
});
