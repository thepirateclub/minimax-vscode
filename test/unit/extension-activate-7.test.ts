import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TOOL_SSE, TODO_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('takes the list of the tasks with it when the chat rolls back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TODO_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('todos').length).toBe(1);
    });
    const userId = ofType('user_message')[0]?.id ?? '';
    // The turn is over when the anchor of the request is in the state.
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        turns?: unknown[];
      }>;
      expect(stored[0]?.turns?.length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'rewind', id: userId });
    await waitForState(() => {
      expect(ofType('todos').length).toBe(1);
    });
    // The list of the turn that goes away goes away with it.
    expect(ofType('todos')[0]!.todos).toEqual([]);
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        todos?: unknown[];
      }>;
      expect(stored[0]?.todos).toEqual([]);
    });
  });

  it('writes the list of the tasks while the turn runs and keeps the last complete turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The first turn ends, the second one waits for the approval of a write.
    state.responses.push(TEXT_SSE, TODO_SSE, TOOL_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'first question', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        turns?: unknown[];
      }>;
      expect(stored[0]?.turns?.length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'second question', mentions: [], selections: [] });
    // The turn waits for the approval of the write, the list is written already.
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        todos?: unknown[];
        messages: unknown[];
        uiMessages: Array<{ text?: string }>;
      }>;
      expect(stored[0]?.todos).toHaveLength(1);
      // The session keeps the last complete turn, not the running one.
      expect(stored[0]?.messages).toHaveLength(2);
      expect(stored[0]?.uiMessages).toHaveLength(2);
    });
    const stored = state.globalState.get('minimax.sessions') as Array<{
      uiMessages: Array<{ text?: string }>;
    }>;
    expect(stored[0]?.uiMessages.map((message) => message.text)).not.toContain(
      'second question'
    );
  });

  it('carries the list of the tasks into the request of the next turn', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The model writes the list and answers, the next turn carries it.
    state.responses.push(TODO_SSE, TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
    // The turn is over, the agent waits for the next request.
    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'continue the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(state.bodies.length).toBe(3);
    });

    // The list was empty when the first turn started, that request has no section.
    const first = JSON.parse(state.bodies[0]!) as { system: string };
    expect(first.system).not.toContain('Tasks:');
    // The list of the tasks is a section of the prompt of the model.
    const body = JSON.parse(state.bodies[2]!) as { system: string };
    expect(body.system).toContain('Tasks:');
    expect(body.system).toContain('- [pending] Read the parser (high)');
    expect(body.system).toContain('\nTasks:\n- [pending] Read the parser (high)');
  });

  it('keeps the goal of the session in the state of the host', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000,
      requestLimit: 8,
      secondsLimit: 600
    });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });
    const goal = ofType('goal')[0]!.goal!;
    expect(goal.objective).toBe('Rewrite the parser');
    expect(goal.tokenBudget).toBe(12000);
    expect(goal.requestLimit).toBe(8);
    expect(goal.secondsLimit).toBe(600);
    expect(goal.status).toBe('active');

    // The goal is in the saved session.
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { objective: string };
      }>;
      expect(stored[0]?.goal?.objective).toBe('Rewrite the parser');
    });

    // The goal comes back after a restart of the extension.
    await boot();
    const inits = ofType('init');
    expect(inits[inits.length - 1]!.state.goal?.objective).toBe('Rewrite the parser');
  });

  it('counts the spend of a request into the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
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
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('goal').length).toBeGreaterThan(0);
    });
    const goal = ofType('goal').pop()!.goal!;
    // The request spent 11 input tokens and 7 output tokens.
    expect(goal.used.tokens).toBe(18);
    expect(goal.used.requests).toBe(1);
  });
});
