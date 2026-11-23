import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TODO_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('clears the list of the tasks on the button of the reader', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TODO_SSE, TEXT_SSE);
    await boot();

    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('todos').some((message) => message.todos.length > 0)).toBe(true);
    });
    await waitForState(() => {
      expect(ofType('status').at(-1)?.state).toBe('idle');
    });

    state.posted.length = 0;
    state.receive?.({ type: 'clear_todos' });
    await waitForState(() => {
      expect(ofType('todos')).toHaveLength(1);
    });
    expect(ofType('todos')[0]!.todos).toEqual([]);
    // The saved session has no tasks, the reload does not bring them back.
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{ todos?: unknown[] }>;
      expect(stored[0]?.todos ?? []).toEqual([]);
    });
  });

  it('sends the time of the turn to the panel with the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE);
    // The clock of the test: every request takes five seconds.
    let clock = 3_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('/v1/messages')) {
          clock += 5000;
        }
        return base(url, init);
      })
    );
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        secondsLimit: 600
      });
      await waitForState(() => {
        expect(ofType('goal').length).toBe(1);
      });

      state.posted.length = 0;
      state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
      await waitForState(() => {
        expect(ofType('status').pop()?.state).toBe('idle');
      });
      // The widget of the goal shows the time of the turn, the panel gets
      // the goal with the seconds of the turn and not with the seconds of
      // the turn before it.
      const goal = ofType('goal').pop()!.goal!;
      expect(goal.used.seconds).toBe(5);
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('does not charge the goal for the time between the turns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The clock of the test: every failed request takes five seconds.
    let clock = 4_000_000;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const base = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).includes('/v1/messages')) {
          clock += 5000;
          return new Response(
            JSON.stringify({ error: { message: 'bad request' } }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }
        return base(url, init);
      })
    );
    const storedGoal = () => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { used: { seconds: number } };
      }>;
      return stored[0]?.goal;
    };
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        secondsLimit: 600
      });
      await waitForState(() => {
        expect(ofType('goal').length).toBe(1);
      });

      state.receive?.({ type: 'send', text: 'first', mentions: [], selections: [] });
      await waitForState(() => {
        expect(ofType('error').length).toBe(1);
      });
      await waitForState(() => {
        expect(storedGoal()?.used.seconds).toBe(5);
      });

      // The user waits a minute between the turns, the waiting is not
      // work.
      clock += 60_000;
      state.receive?.({ type: 'send', text: 'second', mentions: [], selections: [] });
      await waitForState(() => {
        expect(ofType('error').length).toBe(2);
      });
      // Two turns of five seconds, the idle minute is not in the goal.
      await waitForState(() => {
        expect(storedGoal()?.used.seconds).toBe(10);
      });
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('carries the goal of the session into the request of the model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    await boot();

    state.receive?.({
      type: 'set_goal',
      objective: 'Rewrite the parser',
      tokenBudget: 12000,
      requestLimit: 8
    });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
    await waitForState(() => {
      expect(state.bodies.length).toBe(1);
    });
    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    // The goal is a section of the prompt of the model.
    const first = JSON.parse(state.bodies[0]!) as { system: string };
    expect(first.system).toContain('Goal: Rewrite the parser');
    expect(first.system).toContain('Budget: 12000 tokens, 8 requests');
    expect(first.system).toContain('Used: 0 tokens, 0 requests');

    // The next request carries the spend of the previous one.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await waitForState(() => {
      expect(state.bodies.length).toBe(2);
    });
    const second = JSON.parse(state.bodies[1]!) as { system: string };
    expect(second.system).toContain('Goal: Rewrite the parser');
    expect(second.system).toContain('Used: 18 tokens, 1 requests');
  });
});
