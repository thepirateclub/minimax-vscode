import type { AgentMode } from '../config/models';

export interface PromptContext {
  workspaceRoot: string;
  os: string;
  shell: string;
  mode: AgentMode;
  tools: string[];
  rulesText: string;
  treeText: string;
  stackText: string;
  openFilesText: string;
}

// The tool list stays short and readable, the registry decides which names
// are actually available in the current mode.
const TOOL_LINES: Array<{ name: string; line: string }> = [
  {
    name: 'read_file',
    line: '- read_file(path, start_line?, end_line?) - read a text file with line numbers'
  },
  {
    name: 'write_file',
    line: '- write_file(path, content) - create a file or replace its whole content'
  },
  {
    name: 'edit_file',
    line: '- edit_file(path, old_string, new_string, replace_all?) - replace an exact string'
  },
  { name: 'list_files', line: '- list_files(path?, depth?) - list the project layout' },
  {
    name: 'search_code',
    line: '- search_code(query, path?, max_results?) - search for a literal string'
  },
  {
    name: 'run_terminal',
    line: '- run_terminal(command, cwd?, timeout_ms?) - run a shell command in the workspace root'
  }
];

export function buildSystemPrompt(context: PromptContext): string {
  const plan = context.mode === 'plan';
  const sections: string[] = [
    'You are MiniMax Agent, a coding agent working inside Visual Studio Code.',
    '',
    'Mode: ' + (plan ? 'PLAN' : 'CODE'),
    plan
      ? '- This session is read-only. You cannot write files and you cannot run commands.'
      : '- You can change files and run commands. Every write_file and edit_file call shows the user a diff and waits for approval, run_terminal always waits for approval too.',
    '',
    'How you work:',
    '- Investigate before you change anything. Use list_files and search_code to understand the project, then read_file to load the exact files you need.',
    plan
      ? '- Answer with a concrete plan: name the files you would change and the exact edits, step by step. The user applies the plan after switching to code mode.'
      : '- Make the smallest change that solves the task. Prefer edit_file over write_file when only part of a file changes.',
    '- After a tool returns, use its output. Never guess the content of a file you have not read.',
    '- Report what you changed and what you verified. State plainly when something failed.',
    '- Answer in the language of the user request.',
    '',
    'Tools you can call:',
    ...TOOL_LINES.filter((tool) => context.tools.includes(tool.name)).map((tool) => tool.line),
    '',
    'Environment:',
    '- Workspace root: ' + context.workspaceRoot,
    '- OS: ' + context.os,
    '- Shell: ' + context.shell,
    '- Paths in tool arguments are relative to the workspace root.'
  ];

  if (context.stackText.length > 0) {
    sections.push('', 'Project manifests detected:', context.stackText);
  }
  if (context.treeText.length > 0) {
    sections.push('', 'Project layout:', context.treeText);
  }
  if (context.openFilesText.length > 0) {
    sections.push('', 'Files open in the editor:', context.openFilesText);
  }
  if (context.rulesText.length > 0) {
    sections.push('', 'Project rules that you must follow:', context.rulesText);
  }

  return sections.join('\n');
}
