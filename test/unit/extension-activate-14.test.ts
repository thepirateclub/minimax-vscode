import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, TODO_SSE, taskSse, writeSse, CHILD_TEXT_SSE, stubFetch, boot, ofType, runGit } from '../helpers/extensionHarness';

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

  it('a deleted chat stops its turn and does not come back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The chat writes a file and answers, the reader deletes it while the
    // write waits for the answer of the reader.
    state.responses.push(
      writeSse('toolu_1', 'note.txt', 'written by the agent'),
      TEXT_SSE
    );
    await boot();
    const first = ofType('init')[0]!.state.activeSessionId;

    state.receive?.({ type: 'send', text: 'write a note', mentions: [], selections: [] });
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });

    // The reader opens another chat and deletes the busy one.
    state.receive?.({ type: 'new_session' });
    await waitForState(() => {
      expect(ofType('init').length).toBeGreaterThan(1);
    });
    state.receive?.({ type: 'delete_session', id: first! });

    // The turn was stopped: the approval that waited is rejected and the
    // turn runs to its end instead of hanging on the answer of the reader.
    await waitForState(() => {
      expect(state.responses.length).toBe(0);
    });
    // The finished turn did not write the deleted chat back into the
    // store of the host.
    const stored = state.globalState.get('minimax.sessions') as Array<{ id: string }>;
    expect(stored.some((session) => session.id === first)).toBe(false);
    for (const message of ofType('sessions')) {
      expect(message.sessions.some((session) => session.id === first)).toBe(false);
    }
  });

  it('the prompt of the child carries the goal, the tasks and the state of the repository', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The workspace is a repository, its state goes into the prompt.
    await runGit('git', ['init'], { cwd: root });
    // The model writes the tasks and then it starts the child.
    state.responses.push(
      TODO_SSE,
      taskSse('explore', 'find the parser'),
      TEXT_SSE,
      TEXT_SSE
    );
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
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await waitForState(() => {
      expect(state.bodies.length).toBeGreaterThan(2);
    });
    // The third request is the request of the child.
    const child = JSON.parse(state.bodies[2]!) as { system: string };
    expect(child.system).toContain('Goal: Rewrite the parser');
    expect(child.system).toContain('Tasks:');
    expect(child.system).toContain('Repository:');
  });

  it('the permission of the parent works for the child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The parent writes a file, then it starts a worker that writes too.
    state.responses.push(
      writeSse('toolu_1', 'note.txt', 'written by the agent'),
      taskSse('worker', 'write another note'),
      writeSse('toolu_1', 'child.txt', 'written by the child'),
      TEXT_SSE,
      TEXT_SSE
    );
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'write and delegate',
      mentions: [],
      selections: []
    });

    // The parent asks the reader for a permission.
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    const approval = ofType('approval_request')[0]!.approval;
    expect(approval.id.startsWith('child-')).toBe(false);
    state.receive?.({ type: 'approve', id: approval.id, allowForSession: true });

    // The write of the child needs no permission, the reader allowed the
    // tool for the session.
    await waitForState(async () => {
      expect(await readFile(join(root, 'child.txt'), 'utf8')).toBe('written by the child');
    });
    expect(ofType('approval_request').length).toBe(1);
  });

  it('the permission of the child works for the next child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The parent starts two workers, both of them write a file.
    state.responses.push(
      taskSse('worker', 'write the first note'),
      writeSse('toolu_1', 'first.txt', 'first'),
      TEXT_SSE,
      taskSse('worker', 'write the second note'),
      writeSse('toolu_1', 'second.txt', 'second'),
      TEXT_SSE,
      TEXT_SSE
    );
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'delegate twice',
      mentions: [],
      selections: []
    });

    // The first child asks the reader.
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    state.receive?.({
      type: 'approve',
      id: ofType('approval_request')[0]!.approval.id,
      allowForSession: true
    });

    // The second child writes without a question.
    await waitForState(async () => {
      expect(await readFile(join(root, 'second.txt'), 'utf8')).toBe('second');
    });
    expect(ofType('approval_request').length).toBe(1);
  });

  it('the answer of the child is the content of the call and not the journal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The child answers in three pieces.
    state.responses.push(taskSse('explore', 'find the parser'), CHILD_TEXT_SSE, TEXT_SSE);
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'explore the project',
      mentions: [],
      selections: []
    });

    await waitForState(() => {
      const end = ofType('tool_end').find((message) => message.name === 'task');
      expect(end?.content).toContain('src/app.ts');
    });
    // The journal of the call holds the actions of the child, the answer of
    // the child is not shredded into it.
    const lines = ofType('tool_progress').map((message) => message.line);
    expect(lines).not.toContain('The parser');
    expect(lines.some((line) => line.includes('src/app.ts'))).toBe(false);
    // The card shows the answer once, in the content of the call.
    const end = ofType('tool_end').find((message) => message.name === 'task');
    expect(end?.content).toContain('The parser is in src/app.ts.');
  });
});
