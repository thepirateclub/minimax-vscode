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
    line:
      '- read_file(path, start_line?, end_line?) - read a text file, a single line or a range of lines'
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
    name: 'git_status',
    line: '- git_status() - the branch and the changed files of the repository'
  },
  {
    name: 'git_diff',
    line: '- git_diff(staged?, ref?, paths?, context_lines?) - the changes as a diff'
  },
  {
    name: 'git_log',
    line: '- git_log(limit?, paths?, grep?) - the commits of the repository'
  },
  {
    name: 'git_show',
    line: '- git_show(ref, paths?) - one commit with its changes'
  },
  {
    name: 'git_branch',
    line: '- git_branch(all?) - the branches of the repository'
  },
  {
    name: 'git_blame',
    line: '- git_blame(path, start_line?, end_line?) - who changed every line of a file'
  },
  {
    name: 'git_stage',
    line: '- git_stage(paths, unstage?) - stage the files for the next commit'
  },
  {
    name: 'git_commit',
    line: '- git_commit(message, amend?) - commit the staged files'
  },
  {
    name: 'git_branch_create',
    line: '- git_branch_create(name, base?, checkout?) - create a branch and switch to it'
  },
  {
    name: 'git_checkout',
    line: '- git_checkout(ref) - switch to another branch or a commit'
  },
  {
    name: 'run_terminal',
    line: '- run_terminal(command, cwd?, timeout_ms?) - run a shell command in the workspace root'
  },
];

// The state of the repository is a section of its own, it changes between the
// turns and the model has to see the fresh one.
export function renderGitContext(lines: string[]): string {
  if (lines.length === 0) {
    return '';
  }
  return ['Repository:', ...lines.map((line) => '- ' + line)].join('\n');
}

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
    '- Never run a git command in the terminal, the git tools do the same work and read the output of git in the code: git_status, git_diff, git_log, git_show, git_branch, git_blame, git_stage, git_commit, git_branch_create, git_checkout.',
    '- After a tool returns, use its output. Never guess the content of a file you have not read.',
    '- Report what you changed and what you verified. State plainly when something failed.',
    '- Answer in the language of the user request.',
    '',
    'Answer format:',
    '- Format the answer as markdown: a heading per part, short paragraphs, bullet lists for the steps.',
    '- Put every code sample into a fenced code block, the panel renders it with a copy button.',
    '- When the code of the block comes from a file of the project, write the path of the file after the fence marker, for example ```src/api/history.ts. The panel shows the name of the file in the header and opens the file on a click. Use the same path you passed to read_file.',
    '- When the code is new and belongs to no file, write only the language after the fence marker, for example ```ts.',
    '- Keep it skimmable: lead with the result, the details come after. No wall of text.',
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
