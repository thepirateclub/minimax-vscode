import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, renderGitContext, type PromptContext } from '../../src/agent/prompt';

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

  it('adds the state of the repository as a section', () => {
    expect(renderGitContext(['Branch main, 2 changed files'])).toContain('Repository:');
    expect(renderGitContext(['Branch main, 2 changed files'])).toContain('- Branch main');
    expect(renderGitContext([])).toBe('');
  });
});
