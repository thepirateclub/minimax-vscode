import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, MESSAGES_URL, TEXT_SSE, GOAL_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

vi.mock('vscode', async () => (await import('../helpers/vscodeMock')).vscodeMock());

describe('extension activation', () => {
  beforeEach(() => {
    state.commands.clear();
    state.viewProviders.clear();
    state.config.clear();
    state.workspaceConfig.clear();
    state.secrets.clear();
    state.globalState.clear();
    state.posted = [];
    // Every test has its own answers and its own log of the network. The
    // controller of the previous test keeps the stub it was built with, a
    // late request of it cannot take the answer of this test.
    state.fetched = [];
    state.headers = [];
    state.bodies = [];
    state.responses = [];
    state.editor = undefined;
    state.documents.length = 0;
    state.files.length = 0;
    state.failState = false;
    state.receive = undefined;
    state.progressCancel = undefined;
    state.warningAnswer = undefined;
    state.warningCalls.length = 0;
    state.theme = 2;
    state.themeListener = undefined;
    state.opened.length = 0;
    state.shown.length = 0;
    state.holdResponse = undefined;
    stubFetch(state.responses, {
      fetched: state.fetched,
      headers: state.headers,
      bodies: state.bodies
    });
  });

  it('refuses a turn while the budget of the goal is over', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 10
    });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    // The turn has to be over, otherwise the second request finds the
    // agent busy.
    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    // The spend of the request (18 tokens) broke the limit of 10 tokens.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('notice').length).toBeGreaterThan(0);
    });
    const notice = ofType('notice')[0]!;
    expect(notice.message).toContain('budget');
    expect(notice.message).toContain('Rewrite the parser');
    // The request did not go out.
    expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(1);
  });

  it('keeps the spend when the user raises the limit of the same goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 10
    });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The user raises the limit of the same goal, the spend stays.
    state.posted.length = 0;
    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000
    });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });
    const goal = ofType('goal')[0]!.goal!;
    expect(goal.tokenBudget).toBe(12000);
    // The request spent 18 tokens, the raise of the limit does not forget it.
    expect(goal.used.tokens).toBe(18);
    expect(goal.used.requests).toBe(1);
    expect(goal.status).toBe('active');
  });

  it('refuses a limit of the goal that is not a positive number', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 0
    });
    await waitForState(() => {
      expect(ofType('notice').length).toBe(1);
    });
    const notice = ofType('notice')[0]!;
    expect(notice.message).toContain('positive numbers');
    expect(notice.kind).toBe('error');
    // The goal was not set.
    expect(ofType('goal').length).toBe(0);
  });

  it('applies the status of the goal that the model sets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(GOAL_SSE, TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000
    });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'do the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('tool_end').length).toBe(1);
    });

    // The host applies the status that the model set.
    const goal = ofType('goal').pop()!.goal!;
    expect(goal.status).toBe('complete');
    // The reason of the model reaches the user in the card of the call,
    // the card stays in the saved chat, a notice printed it twice.
    const start = ofType('tool_start').find((message) => message.name === 'update_goal');
    expect(start?.input['note']).toBe('The parser is rewritten');
    expect(
      ofType('notice').some((message) => message.message.includes('The parser is rewritten'))
    ).toBe(false);
  });

  it('keeps the limit of the goal when the model closes it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(GOAL_SSE, TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 10
    });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'do the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The model closed the goal, the spend is counted anyway.
    const goal = ofType('goal').pop()!.goal!;
    expect(goal.status).toBe('complete');
    expect(goal.used.tokens).toBe(27);
    expect(goal.used.requests).toBe(2);

    // The limit of the goal still holds, the next turn is refused.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('notice').length).toBeGreaterThan(0);
    });
    expect(ofType('notice')[0]!.message).toContain('budget');
    // The request did not go out.
    expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(2);
  });
});
