import { describe, expect, it } from 'vitest';
import { parseAgentLog } from '../../src/ui/webview/agentLog';

// The host writes the journal of a sub-agent as lines: the start of an
// action, its end, the lines of its diff. The panel shows one row per action.
describe('parseAgentLog', () => {
  it('pairs the start and the end of an action into one row', () => {
    expect(
      parseAgentLog(['list_files app/src', 'list_files done', 'read_file app/a.ts', 'read_file failed'])
    ).toEqual([
      { name: 'list_files', target: 'app/src', state: 'done', added: 0, removed: 0 },
      { name: 'read_file', target: 'app/a.ts', state: 'failed', added: 0, removed: 0 }
    ]);
  });

  it('keeps the last action running until its end comes', () => {
    expect(parseAgentLog(['search_code foo'])).toEqual([
      { name: 'search_code', target: 'foo', state: 'running', added: 0, removed: 0 }
    ]);
  });

  it('counts the lines of the diff, it does not print them', () => {
    const rows = parseAgentLog(['edit_file a.ts', 'edit_file done', '+ one', '+ two', '- old']);
    expect(rows).toEqual([
      { name: 'edit_file', target: 'a.ts', state: 'done', added: 2, removed: 1 }
    ]);
  });

  it('takes an action without a target', () => {
    expect(parseAgentLog(['git_status', 'git_status done'])).toEqual([
      { name: 'git_status', target: '', state: 'done', added: 0, removed: 0 }
    ]);
  });

  it('reads a target named done as a target when no action is open', () => {
    expect(parseAgentLog(['read_file done'])[0]).toMatchObject({ target: 'done', state: 'running' });
  });

  it('keeps an error of the child as a row of its own', () => {
    expect(parseAgentLog(['error: network'])).toEqual([
      { name: '', target: 'network', state: 'failed', added: 0, removed: 0 }
    ]);
  });

  it('reads the start of an action with its input, the panel names it like a card', () => {
    const start = JSON.stringify({ tool: 'search_code', input: { query: 'formatCount', path: 'src' } });
    expect(parseAgentLog([start, 'search_code done'])).toEqual([
      {
        name: 'search_code',
        target: '',
        input: { query: 'formatCount', path: 'src' },
        state: 'done',
        added: 0,
        removed: 0
      }
    ]);
  });

  it('reads a broken start line as a plain line', () => {
    expect(parseAgentLog(['{"tool":'])[0]).toMatchObject({ name: '{"tool":', state: 'running' });
  });
});

// The rows of a sub-agent stand on the same timeline as the cards: the
// start carries its moment, the end its duration.
describe('the moments of the actions of a sub-agent', () => {
  it('reads the moment of the start and the duration of the end', () => {
    expect(
      parseAgentLog(['{"tool":"read_file","input":{"path":"a.ts"},"at":1000}', 'read_file done 250ms'])
    ).toEqual([
      { name: 'read_file', target: '', input: { path: 'a.ts' }, at: 1000, durationMs: 250, state: 'done', added: 0, removed: 0 }
    ]);
  });

  it('reads the end with a duration as an end and not as a target', () => {
    expect(parseAgentLog(['{"tool":"git_status","input":{}}', 'git_status failed 12ms'])[0]).toMatchObject({
      state: 'failed',
      durationMs: 12
    });
  });
});
