import { describe, expect, it } from 'vitest';
import { formatStepSummary, summarizeStep } from '../../src/ui/webview/stepSummary';
import type { UiMessage, UiToolCall } from '../../src/ui/protocol';

function card(tool: Omit<UiToolCall, 'id'>): UiMessage {
  return { id: tool.name + Math.random(), role: 'tool', tool: { id: 'x', ...tool } };
}

// A group of hundreds of actions reads by what it did.
describe('the summary of a long group', () => {
  it('counts the kinds of the actions and the changed files with their size', () => {
    const tools = [
      card({ name: 'read_file', input: { path: 'a.ts' } }),
      card({ name: 'read_file', input: { path: 'b.ts' } }),
      card({ name: 'edit_file', input: { path: 'a.ts' }, diff: { path: 'a.ts', lines: [{ type: 'add', text: 'x' }, { type: 'remove', text: 'y' }] } }),
      card({ name: 'edit_file', input: { path: 'a.ts' }, diff: { path: 'a.ts', lines: [{ type: 'add', text: 'z' }] } }),
      card({ name: 'run_terminal', input: { command: 'npm test' }, isError: true }),
      card({ name: 'search_code', input: { query: 'x' } }),
      card({ name: 'git_status', input: {} })
    ];
    expect(formatStepSummary(summarizeStep(tools))).toBe(
      'Changed 1 file +2 −1 · 2 reads · 1 search · 1 run · 1 git action · 1 failed'
    );
  });

  it('does not count a failed edit as a change', () => {
    const summary = summarizeStep([card({ name: 'write_file', input: { path: 'a.ts' }, isError: true })]);
    expect(summary.files).toBe(0);
    expect(formatStepSummary(summary)).toBe('1 failed');
  });
});
