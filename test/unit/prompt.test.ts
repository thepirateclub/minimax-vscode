import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  renderGitContext,
  renderTasksContext,
  type PromptContext
} from '../../src/agent/prompt';

const context: PromptContext = {
  workspaceRoot: 'C:\\work',
  os: 'win32',
  shell: 'pwsh',
  mode: 'plan',
  tools: ['read_file', 'list_files'],
  rulesText: '',
  treeText: '',
  stackText: '',
  openFilesText: ''
};

describe('system prompt', () => {
  it('asks the model for a structured markdown answer', () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('Answer format:');
    expect(prompt).toMatch(/markdown/i);
    expect(prompt).toMatch(/fenced code block/i);
  });

  it('asks the model to name the file of a quoted snippet', () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toMatch(/path of the file/i);
    expect(prompt).toMatch(/only the language/i);
  });

  it('lists only the tools of the current mode', () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('read_file');
    expect(prompt).not.toContain('write_file');
  });

  it('lists the git tools for the model', () => {
    const prompt = buildSystemPrompt({
      ...context,
      tools: ['read_file', 'git_status', 'git_commit']
    });
    expect(prompt).toContain('git_status');
    expect(prompt).toContain('git_commit');
  });

  it('keeps the git commands out of the terminal', () => {
    const prompt = buildSystemPrompt({
      ...context,
      tools: ['read_file', 'git_status', 'run_terminal']
    });
    expect(prompt).toMatch(/never run a git command/i);
    expect(prompt).toContain('git_status');
  });

  it('adds the state of the repository as a section', () => {
    expect(renderGitContext(['Branch main, 2 changed files'])).toContain('Repository:');
    expect(renderGitContext(['Branch main, 2 changed files'])).toContain('- Branch main');
    expect(renderGitContext([])).toBe('');
  });

  it('lists the tools of the worktrees', () => {
    const prompt = buildSystemPrompt({
      ...context,
      tools: ['git_worktree_list', 'git_worktree_add', 'git_worktree_remove']
    });
    expect(prompt).toContain('git_worktree_list');
    expect(prompt).toContain('git_worktree_add');
    expect(prompt).toContain('git_worktree_remove');
  });

  it('tells the model that the search takes several words and a file', () => {
    const prompt = buildSystemPrompt({ ...context, tools: ['search_code'] });
    expect(prompt).toContain('patterns');
    expect(prompt).toContain('ignore_case');
    expect(prompt).toContain('path');
  });
});

describe('the list of tasks in the prompt', () => {
  it('renders every task with its state and its priority', () => {
    const text = renderTasksContext([
      { content: 'Read the parser', status: 'in_progress', priority: 'high' },
      { content: 'Add tests', status: 'completed', priority: 'medium' }
    ]);
    expect(text).toContain('Tasks:');
    expect(text).toContain('- [in_progress] Read the parser (high)');
    expect(text).toContain('- [completed] Add tests (medium)');
  });

  it('renders nothing when the list is empty', () => {
    expect(renderTasksContext([])).toBe('');
  });
});
