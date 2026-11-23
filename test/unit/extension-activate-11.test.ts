import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TOOL_SSE, TODO_SSE, taskSse, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('sends no section of the goal when the session has no goal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The model writes the list of the tasks, the next turn carries it.
    state.responses.push(TODO_SSE, TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'plan the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('todos').length).toBe(1);
    });
    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });

    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'continue the work', mentions: [], selections: [] });
    await waitForState(() => {
      expect(state.bodies.length).toBe(3);
    });

    const body = JSON.parse(state.bodies[2]!) as { system: string };
    // The session carries the list of the tasks, but it has no goal.
    expect(body.system).toContain('Tasks:');
    expect(body.system).not.toContain('Goal:');
    // An empty section of the goal is not pushed into the prompt.
    expect(body.system).not.toMatch(/\n\n$/);
  });

  it('gives the child of the role explore no tool with a side effect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(taskSse('explore', 'find the parser'), TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await waitForState(() => {
      expect(state.bodies.length).toBeGreaterThan(1);
    });
    // The second request is the request of the child.
    const child = JSON.parse(state.bodies[1]!) as {
      system: string;
      tools: Array<{ name: string }>;
    };
    const names = child.tools.map((tool) => tool.name);
    expect(names).toContain('read_file');
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('run_terminal');
    expect(names).not.toContain('task');
    // The prompt of the child names its role.
    expect(child.system).toContain('You are a sub-agent of the main agent');
    expect(child.system).toContain('Your task is to explore');
  });

  it('the approval of the child carries the preview of the change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(taskSse('worker', 'write a note'), TOOL_SSE, TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'let the worker write',
      mentions: [],
      selections: []
    });

    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    // The approval of the child has an id of its own.
    expect(approval.id.startsWith('child-')).toBe(true);
    expect(approval.name).toBe('write_file');
    // The reader sees the change of the file before he answers.
    expect(approval.preview?.path).toBe('note.txt');
    expect(
      approval.preview?.lines.filter((line) => line.type === 'add').length
    ).toBe(1);
    // Nothing is written before the answer.
    await expect(readFile(join(root, 'note.txt'), 'utf8')).rejects.toThrow();

    state.receive?.({ type: 'approve', id: approval.id, allowForSession: false });

    await waitForState(async () => {
      expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('written by the agent');
    });
    // The change of the child stays in the card of the call: the
    // journal of the child carries the lines of the diff.
    await waitForState(() => {
      const lines = ofType('tool_progress').map((message) => message.line);
      expect(lines).toContain('+ written by the agent');
    });
    // The result of the call stays in the content alone, the journal has
    // its own field.
    await waitForState(() => {
      const end = ofType('tool_end').pop();
      expect(end?.content).not.toContain('+ written by the agent');
    });
  });

  it('the Stop of the parent interrupts the child and the turn ends', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    state.responses.push(taskSse('explore', 'look for the parser'), TEXT_SSE);
    await boot();

    // The request of the child hangs, only the stop of the parent ends it.
    const base = globalThis.fetch;
    let requests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (!href.includes('/v1/messages')) {
          return await base(url, init);
        }
        requests += 1;
        if (requests === 2) {
          const body = typeof init?.body === 'string' ? init.body : '';
          if (body) {
            state.bodies.push(body);
          }
          // The child waits for the answer of the server.
          return await new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            const stop = () => reject(new Error('The operation was aborted.'));
            if (signal?.aborted) {
              stop();
              return;
            }
            signal?.addEventListener('abort', stop);
          });
        }
        if (init?.signal?.aborted) {
          throw new Error('The operation was aborted.');
        }
        return await base(url, init);
      })
    );

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await waitForState(() => {
      expect(state.bodies.length).toBeGreaterThan(1);
    });
    // The child waits, the reader stops the turn.
    state.receive?.({ type: 'stop' });

    await waitForState(() => {
      expect(ofType('status').pop()?.state).toBe('idle');
    });
    // The host tells the reader that the request was stopped.
    expect(
      ofType('notice').some((message) => message.message.includes('stopped'))
    ).toBe(true);

    // The chat is free again, the next request of the reader goes out.
    state.posted.length = 0;
    state.receive?.({ type: 'send', text: 'again', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('text_delta').length).toBeGreaterThan(0);
    });
  });
});
