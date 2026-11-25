import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Agent } from '../../src/agent/agent';
import { createDeleteTools } from '../../src/tools/delete';
import { ToolRegistry } from '../../src/tools/registry';
import { alwaysConfirms } from '../../src/ui/approvalScope';
import { ApprovalGate, type ApprovalRequest } from '../../src/ui/approvals';
import type { UiApprovalFile, UiMessage } from '../../src/ui/protocol';
import { ApprovalCard } from '../../src/ui/webview/components/ApprovalCard';
import { FakeClient, textResponse, toolResponse } from '../helpers/agentFixture';

function deleteTool() {
  const tool = createDeleteTools().find((entry) => entry.name === 'delete_files');
  if (!tool) {
    throw new Error('the tool delete_files is missing');
  }
  return tool;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('the deletion always asks the reader', () => {
  it('asks even when a rule of the reader allows the tool', async () => {
    const requests: ApprovalRequest[] = [];
    const gate = new ApprovalGate({
      // "Always allow" of the whole tool would hide the deletion.
      autoApprove: ['delete_files'],
      request: async (request) => {
        requests.push(request);
        return { approved: true, allowForSession: false };
      }
    });
    const decision = await gate.approve(deleteTool(), { path: 'a.txt' });
    expect(decision.approved).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.toolName).toBe('delete_files');
  });

  it('asks again for the next call, the grant of the session does not cover it', async () => {
    let asked = 0;
    const gate = new ApprovalGate({
      autoApprove: [],
      request: async () => {
        asked += 1;
        return { approved: true, allowForSession: true };
      }
    });
    await gate.approve(deleteTool(), { path: 'a.txt' });
    await gate.approve(deleteTool(), { path: 'b.txt' });
    expect(asked).toBe(2);
  });

  it('knows the tool that never rides on a grant', () => {
    expect(alwaysConfirms('delete_files')).toBe(true);
    expect(alwaysConfirms('write_file')).toBe(false);
  });

  it('deletes nothing when the reader did not confirm', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-del-'));
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8');
    const client = new FakeClient([
      toolResponse('delete_files', { path: 'a.txt' }),
      textResponse('done')
    ]);
    const registry = new ToolRegistry();
    for (const entry of createDeleteTools()) {
      registry.register(entry);
    }
    const agent = new Agent({
      client,
      registry,
      approval: new ApprovalGate({
        // The rule of the reader does not cover the deletion, the card asks.
        autoApprove: ['delete_files'],
        request: async () => ({ approved: false, allowForSession: false })
      }),
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 32000,
      maxIterations: 5,
      effort: 'max',
      mode: 'code',
      systemPrompt: 'system',
      workspaceRoot: root,
      logger: { info: () => undefined, error: () => undefined },
      onEvent: () => undefined
    });
    await agent.run('delete it', []);
    expect(await exists(join(root, 'a.txt'))).toBe(true);
  });
});

describe('the card of the confirmation of a deletion', () => {
  function card(files: UiApprovalFile[]): string {
    const message: UiMessage = {
      id: 'm1',
      role: 'assistant',
      approval: {
        id: 'a1',
        name: 'delete_files',
        input: { paths: ['a.txt', 'b.txt'] },
        files
      }
    };
    return renderToStaticMarkup(
      createElement(ApprovalCard, {
        message,
        onApprove: () => undefined,
        onReject: () => undefined
      })
    );
  }

  it('lists every file of the deletion', () => {
    const markup = card([
      { path: 'a.txt', bytes: 4 },
      { path: 'b.txt', bytes: 4 }
    ]);
    expect(markup).toContain('a.txt');
    expect(markup).toContain('b.txt');
  });

  it('names the number of the files and their size', () => {
    const markup = card([
      { path: 'a.txt', bytes: 4 },
      { path: 'b.txt', bytes: 4 }
    ]);
    expect(markup).toContain('2 files');
    expect(markup).toContain('8 B');
  });

  it('says that the deletion cannot be undone', () => {
    const markup = card([{ path: 'a.txt', bytes: 4 }]);
    expect(markup.toLowerCase()).toContain('permanent');
  });

  it('has no grant of the session, the deletion is never silent', () => {
    const markup = card([{ path: 'a.txt', bytes: 4 }]);
    expect(markup).not.toContain('Always allow');
  });
});
