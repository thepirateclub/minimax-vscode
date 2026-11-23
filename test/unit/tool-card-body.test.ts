import { describe, expect, it } from 'vitest';
import { card, summaryOf, titleOf } from '../helpers/toolCardFixture';

describe('the body of a card', () => {
  it('does not draw an empty block of the arguments', () => {
    const markup = card({ name: 'git_status', input: {}, content: 'branch: main' });
    // A tool without arguments has nothing to show, an empty box reads
    // like a panel that failed to open.
    expect(markup).not.toContain('tool-input');
  });

  it('names the worktrees of the repository', () => {
    const markup = card({
      name: 'git_worktree_list',
      input: {},
      content: '.worktrees/wt  feature/x  abc1234'
    });
    expect(titleOf(markup)).toBe('Git worktrees');
  });

  it('names the worktree that the agent adds', () => {
    const markup = card({
      name: 'git_worktree_add',
      input: { path: '.worktrees/wt' },
      content: 'added the worktree .worktrees/wt on the branch feature/x'
    });
    expect(titleOf(markup)).toContain('Add worktree');
    expect(titleOf(markup)).toContain('.worktrees/wt');
  });

  it('shows the time of the action with its unit', () => {
    const markup = card({
      name: 'git_status',
      input: {},
      content: 'branch: main',
      durationMs: 12500
    });
    expect(markup).toContain('12.5s');
    expect(markup).not.toContain('12500 ms');
  });

  it('names the REPL of the language and shows the terminal', () => {
    const node = card({ name: 'repl_node', input: {}, content: '42' });
    const python = card({ name: 'repl_python', input: {}, content: '42' });
    // The card names the language, the raw name of the tool is not a title.
    expect(titleOf(node)).toBe('Node REPL');
    expect(titleOf(python)).toBe('Python REPL');
  });

  it('names the words of the search', () => {
    const markup = card({
      name: 'search_code',
      input: { query: 'hp:', patterns: ['hp:', 'atk:'] },
      content: 'js/units.js:12: hp: 10'
    });
    expect(titleOf(markup)).toContain('hp: atk:');
  });
});

describe('the card of a sub-agent', () => {
  it('names the task and shows the journal of the child', () => {
    const markup = card({
      name: 'task',
      input: {
        description: 'Find the parser',
        prompt: 'Where is it?',
        role: 'explore'
      },
      content: 'The parser is in src/app.ts.',
      progress: ['read_file src/app.ts', 'search_code parser 3 matches']
    });
    // The title names the task of the child.
    expect(markup).toContain('Find the parser');
    // The journal of the child stands in its own block.
    expect(markup).toContain('agent-log');
    expect(markup).toContain('read_file src/app.ts');
    // The answer of the child stands under the journal.
    expect(markup).toContain('The parser is in src/app.ts.');
  });
});

describe('the cards of the session state', () => {
  it('names the update of the tasks and shows the list, not a dump', () => {
    const markup = card({
      name: 'todo_write',
      input: {
        todos: [
          { content: 'Read the parser', status: 'completed', priority: 'high' },
          { content: 'Add tests', status: 'in_progress', priority: 'medium' }
        ]
      },
      content: 'The list of tasks has 2 items, 1 of them are done.'
    });
    expect(titleOf(markup)).toBe('Update tasks');
    expect(summaryOf(markup)).toBe('1/2 done');
    expect(markup).toContain('Add tests');
    expect(markup).not.toContain('tool-input');
    expect(markup).not.toContain('&quot;status&quot;');
  });

  it('names the status the model gave the goal and keeps the note', () => {
    const markup = card({
      name: 'update_goal',
      input: { status: 'complete', note: 'Rounding works' },
      content: 'The goal is marked as complete: Rounding works The status of the goal is set by the model, the limits stay with the user.'
    });
    expect(titleOf(markup)).toBe('Mark goal complete');
    // The whole note stands in the body of the open card, the summary of a
    // folded card carries it.
    expect(markup).toContain('<p class="tool-note">Rounding works</p>');
    expect(summaryOf(markup)).toBe('');
    const folded = card(
      { name: 'update_goal', input: { status: 'complete', note: 'Rounding works' }, content: 'ok' },
      true
    );
    expect(summaryOf(folded)).toBe('Rounding works');
    // The words for the model stay out of the panel.
    expect(markup).not.toContain('the limits stay with the user');
    expect(markup).not.toContain('tool-input');
  });

  it('keeps the text of a refused goal update', () => {
    const markup = card({
      name: 'update_goal',
      input: { status: 'done' },
      content: 'The status of the goal is "complete" or "blocked", not "done".',
      isError: true
    });
    expect(markup).toContain('not &quot;done&quot;');
  });

  it('names the read of the goal', () => {
    expect(titleOf(card({ name: 'get_goal', input: {}, content: 'Objective: x' }))).toBe('Read goal');
  });

  it('does not repeat the answer of a sub-agent in the summary of an open card', () => {
    const tool = {
      name: 'task',
      input: { description: 'Find the parser', role: 'explore' },
      content: 'The parser is in src/app.ts.'
    };
    expect(summaryOf(card(tool))).toBe('');
    // A folded card hides the answer, the summary carries its first line.
    expect(summaryOf(card(tool, true))).toBe('The parser is in src/app.ts.');
  });
});
