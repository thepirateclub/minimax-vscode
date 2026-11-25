import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  renderGitContext,
  renderGoalContext,
  renderTasksContext,
  type PromptContext
} from '../../src/agent/prompt';
import type { GoalState } from '../../src/agent/state';
import { formatGoal } from '../../src/tools/goal';

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

  it('asks the model to plan a few steps and batch the calls', () => {
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('write a short list of the next 2-5 steps');
    expect(prompt).toContain('all the independent tool calls of that list in one response');
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

describe('the goal in the prompt', () => {
  it('shows the goal with its limits and its spend', () => {
    const goal: GoalState = {
      objective: 'Rewrite the parser',
      tokenBudget: 12000,
      requestLimit: 10,
      status: 'active',
      used: { tokens: 4300, requests: 2, seconds: 65 }
    };
    const text = renderGoalContext(goal);
    expect(text).toContain('Goal: Rewrite the parser');
    expect(text).toContain('Budget: 12000 tokens, 10 requests');
    expect(text).toContain('Used: 4300 tokens, 2 requests');
    // The format of the goal is the one of the tool, one place decides it.
    expect(text).toBe(formatGoal(goal));
  });

  it('shows nothing when there is no goal', () => {
    expect(renderGoalContext(undefined)).toBe('');
  });
});
