import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, MESSAGES_URL, TEXT_SSE, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('adds the time of every turn to the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(TEXT_SSE, TEXT_SSE);
    // The clock of the test: every request takes five seconds.
    let clock = 1_000_000;
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
    const storedGoal = () => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { used: { tokens: number; requests: number; seconds: number } };
      }>;
      return stored[0]?.goal;
    };
    const idleCount = () =>
      ofType('status').filter((message) => message.state === 'idle').length;
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        // The idle minute between the turns would cross this limit if the
        // waiting were charged as work.
        secondsLimit: 30
      });
      await waitForState(() => {
        expect(ofType('goal').length).toBe(1);
      });

      const idleBefore = idleCount();
      state.receive?.({ type: 'send', text: 'first', mentions: [], selections: [] });
      await waitForState(() => {
        expect(idleCount()).toBeGreaterThan(idleBefore);
      });
      await waitForState(() => {
        expect(storedGoal()?.used.seconds).toBe(5);
      });

      // The user waits a minute between the turns, the waiting is not work.
      clock += 60_000;
      state.receive?.({ type: 'send', text: 'second', mentions: [], selections: [] });
      // The second turn was not refused: the idle minute is not work.
      await waitForState(() => {
        expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(2);
      });
      expect(
        ofType('notice').filter((message) => message.message.includes('budget'))
      ).toHaveLength(0);
      await waitForState(() => {
        expect(idleCount()).toBeGreaterThan(idleBefore + 1);
      });
      await waitForState(() => {
        expect(storedGoal()?.used.seconds).toBe(10);
      });
      expect(storedGoal()?.used.requests).toBe(2);
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('adds the time of a turn that ended with an error to the goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The clock of the test: the failed request takes five seconds.
    let clock = 2_000_000;
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
        goal?: { used: { tokens: number; requests: number; seconds: number } };
      }>;
      return stored[0]?.goal;
    };
    try {
      await boot();
      state.receive?.({
        type: 'set_goal',
        objective: 'Rewrite the parser',
        secondsLimit: 60
      });
      await waitForState(() => {
        expect(ofType('goal').length).toBe(1);
      });

      state.posted.length = 0;
      state.receive?.({ type: 'send', text: 'hello', mentions: [], selections: [] });
      await waitForState(() => {
        expect(ofType('error').length).toBe(1);
      });
      // The failed turn took five seconds, they are in the goal.
      await waitForState(() => {
        expect(storedGoal()?.used.seconds).toBe(5);
      });
    } finally {
      now.mockRestore();
      vi.stubGlobal('fetch', base);
    }
    // The global is the stub of the file again, the next test is not
    // touched by this one.
    expect(globalThis.fetch).toBe(base);
  });

  it('returns the request to the input when the budget of the goal is over', async () => {
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

    // The spend of the request (18 tokens) broke the limit of 10 tokens.
    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'again',
      mentions: ['src/app.ts'],
      selections: []
    });
    await waitForState(() => {
      expect(ofType('notice').length).toBeGreaterThan(0);
    });
    // The request comes back to the input field, it is not lost.
    const restored = ofType('restore_input')[0]!;
    expect(restored.text).toBe('again');
    expect(restored.mentions).toEqual(['src/app.ts']);
    expect(restored.selections).toEqual([]);
    // The request did not go out.
    expect(state.fetched.filter((url) => url === MESSAGES_URL)).toHaveLength(1);
  });

  it('clears the goal of the session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
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
    state.receive?.({ type: 'clear_goal' });
    await waitForState(() => {
      expect(ofType('goal').length).toBe(1);
    });
    // The panel sees that the goal is gone.
    expect(ofType('goal')[0]!.goal).toBeUndefined();
    // The saved session has no goal.
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        goal?: { objective: string };
      }>;
      expect(stored[0]?.goal).toBeUndefined();
    });
  });
});
