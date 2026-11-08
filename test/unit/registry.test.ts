import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../../src/ui/approvals';
import { ToolRegistry } from '../../src/tools/registry';
import type { ToolEntry } from '../../src/tools/types';

function makeTool(name: string, approval: 'never' | 'always'): ToolEntry {
  return {
    name,
    description: 'desc',
    approval,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'ok' })
  };
}

describe('ToolRegistry', () => {
  it('registers and finds tools', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read_file', 'never'));
    expect(registry.get('read_file')?.name).toBe('read_file');
    expect(registry.list()).toHaveLength(1);
  });

  it('converts tools to the anthropic shape', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read_file', 'never'));
    expect(registry.toAnthropicTools()[0]).toEqual({
      name: 'read_file',
      description: 'desc',
      input_schema: { type: 'object', properties: {} }
    });
  });
});

describe('ApprovalGate', () => {
  it('skips the request for tools that never need approval', async () => {
    const request = vi.fn();
    const gate = new ApprovalGate({ autoApprove: [], request });
    const decision = await gate.approve(makeTool('read_file', 'never'), {});
    expect(decision.approved).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('asks for approval for write tools', async () => {
    const request = vi.fn().mockResolvedValue({ approved: true, allowForSession: false });
    const gate = new ApprovalGate({ autoApprove: [], request });
    const decision = await gate.approve(makeTool('write_file', 'always'), {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(decision.approved).toBe(true);
  });

  it('auto approves tools listed in autoApprove', async () => {
    const request = vi.fn();
    const gate = new ApprovalGate({ autoApprove: ['write_file'], request });
    const decision = await gate.approve(makeTool('write_file', 'always'), {});
    expect(request).not.toHaveBeenCalled();
    expect(decision.approved).toBe(true);
  });

  it('reports a rejection', async () => {
    const request = vi.fn().mockResolvedValue({ approved: false, allowForSession: false });
    const gate = new ApprovalGate({ autoApprove: [], request });
    const decision = await gate.approve(makeTool('write_file', 'always'), {});
    expect(decision.approved).toBe(false);
  });

  it('remembers a session approval', async () => {
    const request = vi.fn().mockResolvedValue({ approved: true, allowForSession: true });
    const gate = new ApprovalGate({ autoApprove: [], request });
    await gate.approve(makeTool('write_file', 'always'), {});
    await gate.approve(makeTool('write_file', 'always'), {});
    expect(request).toHaveBeenCalledTimes(1);
  });
});
