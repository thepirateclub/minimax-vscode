import { describe, expect, it } from 'vitest';
import { activeAction } from '../../src/ui/webview/activityStatus';
import type { UiMessage } from '../../src/ui/protocol';

function toolMessage(
  id: string,
  name: string,
  input: Record<string, unknown>,
  running = false
): UiMessage {
  return {
    id,
    role: 'tool',
    tool: { id, name, input, running }
  };
}

describe('the live status of the agent', () => {
  it('says nothing when no action runs', () => {
    expect(activeAction([])).toBeUndefined();
    expect(activeAction([toolMessage('t1', 'read_file', {})])).toBeUndefined();
  });

  it('names the action that runs now', () => {
    const action = activeAction([
      toolMessage('t1', 'read_file', { path: 'src/ui/format.ts' }, true)
    ]);
    expect(action?.name).toBe('read_file');
    expect(action?.detail).toBe('reads a file');
    expect(action?.target).toBe('src/ui/format.ts');
  });

  it('takes the action that runs last', () => {
    const action = activeAction([
      toolMessage('t1', 'read_file', { path: 'a.ts' }, true),
      toolMessage('t2', 'git_diff', { staged: false }, true)
    ]);
    expect(action?.name).toBe('git_diff');
  });

  it('ignores the action that ended', () => {
    const action = activeAction([
      toolMessage('t1', 'read_file', { path: 'a.ts' }),
      toolMessage('t2', 'git_diff', {}, true)
    ]);
    expect(action?.name).toBe('git_diff');
  });

  it('says what the tool does in words of the reader', () => {
    expect(activeAction([toolMessage('t1', 'git_diff', {}, true)])?.detail).toBe(
      'shows the changes'
    );
    expect(activeAction([toolMessage('t1', 'search_code', {}, true)])?.detail).toBe(
      'searches the code'
    );
  });

  it('falls back to a plain description for an unknown tool', () => {
    const action = activeAction([toolMessage('t1', 'unknown_tool', {}, true)]);
    expect(action?.detail).toBe('runs the tool');
    expect(action?.target).toBe('');
  });

  it('names the command of the terminal', () => {
    const action = activeAction([
      toolMessage('t1', 'run_terminal', { command: 'npm test' }, true)
    ]);
    expect(action?.target).toBe('npm test');
  });
});
