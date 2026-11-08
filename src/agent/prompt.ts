export interface PromptContext {
  workspaceRoot: string;
  os: string;
  shell: string;
  rulesText: string;
  treeText: string;
  stackText: string;
  openFilesText: string;
}

export function buildSystemPrompt(context: PromptContext): string {
  const sections: string[] = [
    'You are MiniMax Agent, a coding agent working inside Visual Studio Code.',
    '',
    'How you work:',
    '- Investigate before you change anything. Use list_files and search_code to understand the project, then read_file to load the exact files you need.',
    '- Make the smallest change that solves the task. Prefer edit_file over write_file when only part of a file changes.',
    '- Every write_file and edit_file call shows the user a diff and waits for approval. run_terminal always waits for approval too.',
    '- After a tool returns, use its output. Never guess the content of a file you have not read.',
    '- Report what you changed and what you verified. State plainly when something failed.',
    '- Answer in the language of the user request.',
    '',
    'Tools you can call:',
    '- read_file(path, start_line?, end_line?) - read a text file with line numbers',
    '- write_file(path, content) - create a file or replace its whole content',
    '- edit_file(path, old_string, new_string, replace_all?) - replace an exact string',
    '- list_files(path?, depth?) - list the project layout',
    '- search_code(query, path?, max_results?) - search for a literal string',
    '- run_terminal(command, cwd?, timeout_ms?) - run a shell command in the workspace root',
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
