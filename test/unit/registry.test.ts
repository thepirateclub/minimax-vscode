import { describe, expect, it, vi } from 'vitest';
import { ApprovalGate } from '../../src/ui/approvals';
import { ToolRegistry } from '../../src/tools/registry';
import type { ToolEntry } from '../../src/tools/types';

function makeTool(
  name: string,
  approval: 'never' | 'always',
  sideEffect = false
): ToolEntry {
  return {
    name,
    description: 'desc',
    approval,
    sideEffect,
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

  it('hides the tools with a side effect in plan mode', () => {
    const registry = new ToolRegistry();
    registry.register(makeTool('read_file', 'never'));
    registry.register(makeTool('write_file', 'always', true));
    expect(registry.toAnthropicTools('plan').map((tool) => tool.name)).toEqual(['read_file']);
    expect(registry.toAnthropicTools('code').map((tool) => tool.name)).toEqual([
      'read_file',
      'write_file'
    ]);
  });

  it('refuses a tool with a side effect in plan mode', () => {
    const registry = new ToolRegistry();
    const entry = makeTool('write_file', 'always', true);
    registry.register(entry);
    expect(registry.isAllowed(entry, 'plan')).toBe(false);
    expect(registry.isAllowed(entry, 'code')).toBe(true);
    expect(registry.isAllowed(makeTool('read_file', 'never'), 'plan')).toBe(true);
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
