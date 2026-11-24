import { describe, expect, it } from 'vitest';
import { ruleAllows, ruleFor, scopeLabel } from '../../src/ui/approvalScope';
import { ApprovalGate } from '../../src/ui/approvals';
import type { ToolEntry } from '../../src/tools/types';

// "Always allow" granted the whole tool: one click on npm test allowed every
// command of the terminal. The grant now has a scope: the prefix of the
// command, the folder of the write, the tool for the rest.
describe('the scope of a grant', () => {
  it('grants a command by its prefix, two words for a runner', () => {
    expect(ruleFor('run_terminal', { command: 'npm test -- --run' })).toBe('run_terminal(npm test)');
    expect(ruleFor('run_cmd', { command: 'dir /b' })).toBe('run_cmd(dir)');
    expect(ruleFor('run_terminal', { command: 'python -m pytest -q' })).toBe('run_terminal(python -m)');
  });

  it('grants a write by the folder of the file', () => {
    expect(ruleFor('write_file', { path: 'src/ui/a.ts' })).toBe('write_file(src/ui/)');
    expect(ruleFor('edit_file', { path: 'README.md' })).toBe('edit_file(./)');
  });

  it('grants the other tools whole', () => {
    expect(ruleFor('git_commit', { message: 'x' })).toBe('git_commit');
  });

  it('matches a command with the same prefix and nothing else', () => {
    expect(ruleAllows('run_terminal(npm test)', 'run_terminal', { command: 'npm test' })).toBe(true);
    expect(ruleAllows('run_terminal(npm test)', 'run_terminal', { command: 'npm test -- -t foo' })).toBe(true);
    expect(ruleAllows('run_terminal(npm test)', 'run_terminal', { command: 'npm testing' })).toBe(false);
    expect(ruleAllows('run_terminal(npm test)', 'run_terminal', { command: 'npm install x' })).toBe(false);
    expect(ruleAllows('run_terminal(npm test)', 'run_cmd', { command: 'npm test' })).toBe(false);
  });

  it('never lets a chained command ride on a prefix', () => {
    for (const command of [
      'npm test && rm -rf src',
      'npm test; del x',
      'npm test | tee out',
      'npm test > out.txt',
      'npm test `whoami`',
      'npm test\nrm x'
    ]) {
      expect(ruleAllows('run_terminal(npm test)', 'run_terminal', { command })).toBe(false);
    }
  });

  it('matches a write inside the folder and not outside it', () => {
    expect(ruleAllows('write_file(src/ui/)', 'write_file', { path: 'src/ui/a.ts' })).toBe(true);
    expect(ruleAllows('write_file(src/ui/)', 'write_file', { path: 'src/ui/deep/b.ts' })).toBe(true);
    expect(ruleAllows('write_file(src/ui/)', 'write_file', { path: 'src/uix/a.ts' })).toBe(false);
    expect(ruleAllows('write_file(src/ui/)', 'write_file', { path: 'src/ui/../../a.ts' })).toBe(false);
    expect(ruleAllows('write_file(./)', 'write_file', { path: 'README.md' })).toBe(true);
    expect(ruleAllows('write_file(./)', 'write_file', { path: 'src/a.ts' })).toBe(false);
  });

  it('reads a bare name as the whole tool, the old settings keep working', () => {
    expect(ruleAllows('run_terminal', 'run_terminal', { command: 'anything && more' })).toBe(true);
    expect(ruleAllows('write_file', 'edit_file', { path: 'a' })).toBe(false);
  });

  it('names the scope on the button of the card', () => {
    expect(scopeLabel('run_terminal', { command: 'npm test -- --run' })).toBe('Always allow "npm test"');
    expect(scopeLabel('edit_file', { path: 'src/ui/a.ts' })).toBe('Always allow edits in src/ui/');
    expect(scopeLabel('write_file', { path: 'a.ts' })).toBe('Always allow writes in the root');
    expect(scopeLabel('git_commit', {})).toBe('Always allow in this session');
  });
});

describe('the gate with the scopes', () => {
  const terminal: ToolEntry = {
    name: 'run_terminal',
    description: '',
    inputSchema: { type: 'object', properties: {} },
    approval: 'always',
    sideEffect: true,
    execute: async () => ({ content: '' })
  };

  it('asks again for a command outside the granted prefix', async () => {
    const asked: string[] = [];
    const gate = new ApprovalGate({
      autoApprove: [],
      request: async (request) => {
        asked.push(String(request.input['command']));
        return { approved: true, allowForSession: true };
      }
    });
    await gate.approve(terminal, { command: 'npm test' });
    await gate.approve(terminal, { command: 'npm test -- -t a' });
    await gate.approve(terminal, { command: 'npm install left-pad' });
    expect(asked).toEqual(['npm test', 'npm install left-pad']);
  });

  it('takes the scoped rules of the settings', async () => {
    let asked = 0;
    const gate = new ApprovalGate({
      autoApprove: ['run_terminal(npm run)'],
      request: async () => {
        asked++;
        return { approved: true, allowForSession: false };
      }
    });
    await gate.approve(terminal, { command: 'npm run build' });
    expect(asked).toBe(0);
    await gate.approve(terminal, { command: 'npx vitest' });
    expect(asked).toBe(1);
  });
});
