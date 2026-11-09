import { describe, expect, it } from 'vitest';
import { ApprovalGate, type ApprovalRequest } from '../../src/ui/approvals';
import type { ToolEntry } from '../../src/tools/types';

function tool(name: string, approval: 'never' | 'always'): ToolEntry {
  return {
    name,
    description: name,
    approval,
    sideEffect: false,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'ok' })
  };
}

describe('ApprovalGate', () => {
  it('never asks for a tool with the never policy', async () => {
    const requests: ApprovalRequest[] = [];
    const gate = new ApprovalGate({
      autoApprove: [],
      request: async (request) => {
        requests.push(request);
        return { approved: true, allowForSession: false };
      }
    });
    const decision = await gate.approve(tool('read_file', 'never'), {});
    expect(decision.approved).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('asks for a tool with the always policy', async () => {
    const requests: ApprovalRequest[] = [];
    const gate = new ApprovalGate({
      autoApprove: [],
      request: async (request) => {
        requests.push(request);
        return { approved: false, allowForSession: false };
      }
    });
    const decision = await gate.approve(tool('write_file', 'always'), { path: 'a.ts' });
    expect(decision.approved).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.toolName).toBe('write_file');
  });

  it('remembers the approval for the whole session', async () => {
    let asked = 0;
    const gate = new ApprovalGate({
      autoApprove: [],
      request: async () => {
        asked += 1;
        return { approved: true, allowForSession: true };
      }
    });
    await gate.approve(tool('write_file', 'always'), {});
    await gate.approve(tool('write_file', 'always'), {});
    expect(asked).toBe(1);
  });

  it('picks up a new auto approve list', async () => {
    let asked = 0;
    const gate = new ApprovalGate({
      autoApprove: [],
      request: async () => {
        asked += 1;
        return { approved: true, allowForSession: false };
      }
    });
    gate.setAutoApprove(['write_file']);
    const decision = await gate.approve(tool('write_file', 'always'), {});
    expect(decision.approved).toBe(true);
    expect(asked).toBe(0);
  });
});
