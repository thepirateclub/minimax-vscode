import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { state } from '../helpers/vscodeMock';
import { waitForState, TEXT_SSE, writeSse, stubFetch, boot, ofType } from '../helpers/extensionHarness';

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

  it('the card of an earlier turn keeps its own result when the id of the call repeats', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-ext-'));
    state.config.set('root', root);
    state.secrets.set('minimax.apiKey', 'test-key');
    // The server sends the same id of the call in two turns.
    state.responses.push(
      writeSse('toolu_1', 'one.txt', 'first'),
      writeSse('toolu_1', 'two.txt', 'second'),
      TEXT_SSE
    );
    await boot();

    state.posted.length = 0;
    state.receive?.({
      type: 'send',
      text: 'write twice',
      mentions: [],
      selections: []
    });

    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(1);
    });
    state.receive?.({
      type: 'approve',
      id: ofType('approval_request')[0]!.approval.id,
      allowForSession: false
    });
    await waitForState(() => {
      expect(ofType('approval_request').length).toBe(2);
    });
    state.receive?.({
      type: 'approve',
      id: ofType('approval_request')[1]!.approval.id,
      allowForSession: false
    });
    await waitForState(() => {
      expect(ofType('tool_end').length).toBe(2);
    });

    // The state of the host keeps two cards, each one with its own result.
    await waitForState(() => {
      const stored = state.globalState.get('minimax.sessions') as Array<{
        uiMessages: Array<{
          role: string;
          tool?: { id: string; content?: string };
        }>;
      }>;
      const cards = stored[0]?.uiMessages.filter((message) => message.role === 'tool') ?? [];
      expect(cards).toHaveLength(2);
      expect(cards[0]?.tool?.id).toBe('toolu_1');
      expect(cards[0]?.tool?.content).toBe('Wrote one.txt');
      expect(cards[1]?.tool?.content).toBe('Wrote two.txt');
    });
  });
});
