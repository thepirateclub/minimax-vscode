import type { AgentMode } from '../config/models';
import type { GoalState, TodoItem } from './state';
import { formatGoal } from '../tools/goal';

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
    line: '- search_code(query, patterns?, ignore_case?, path?, max_results?) - search for a literal string, several words or one file'
  },
  {
    name: 'git_status',
    line: '- git_status() - the branch and the changed files of the repository'
  },
  {
    name: 'git_diff',
    line: '- git_diff(staged?, ref?, ref2?, stat?, name_only?, paths?, context_lines?, directory?) - the changes as a diff, ref and ref2 compare two commits, stat gives the summary, name_only gives the names of the files'
  },
  {
    name: 'git_log',
    line: '- git_log(limit?, paths?, grep?, format?, oneline?) - the commits of the repository, the format picks the shape of a line: oneline, short, medium or full'
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
    name: 'git_worktree_list',
    line:
      '- git_worktree_list() - the worktrees of the repository with their branches'
  },
  {
    name: 'git_worktree_add',
    line:
      '- git_worktree_add(path, branch?, base?) - add a worktree with a branch of its own'
  },
  {
    name: 'git_worktree_remove',
    line:
      '- git_worktree_remove(path, force?) - remove a worktree'
  },
  {
    name: 'git_merge',
    line: '- git_merge(branch, no_ff?, no_commit?, message?) - merge a branch or a commit into the current branch'
  },
  {
    name: 'git_tag',
    line: '- git_tag(name, message?, ref?, force?) - create a tag on a commit, a mark of a release'
  },
  {
    name: 'run_terminal',
    line: '- run_terminal(command, cwd?, timeout_ms?) - run a shell command in the workspace root'
  },
  {
    name: 'run_cmd',
    line: '- run_cmd(command, cwd?, timeout_ms?) - run a command of the windows shell (cmd /c) in the workspace root'
  },
  {
    name: 'repl_node',
    line: '- repl_node(code, timeout_ms?, reset?) - run a piece of javascript in a node process that lives between the calls'
  },
  {
    name: 'repl_python',
    line: '- repl_python(code, timeout_ms?, reset?) - run a piece of python in an interpreter that lives between the calls'
  },
  {
    name: 'container_list',
    line: '- container_list() - the containers and the images of podman or docker'
  },
  {
    name: 'container_logs',
    line: '- container_logs(container, tail?) - the logs of a container'
  },
  {
    name: 'container_run',
    line: '- container_run(image, name?, command?) - run a container'
  },
  {
    name: 'container_stop',
    line: '- container_stop(container) - stop a container'
  },
  {
    name: 'container_exec',
    line: '- container_exec(container, command) - run a command inside a running container'
  },
  {
    name: 'tasks_read',
    line: '- tasks_read(file?) - read the file of the tasks of the project'
  },
  {
    name: 'tasks_update',
    line: '- tasks_update(action, task?, title?, id?, file?) - change the file of the tasks of the project: add, complete, close, update or remove a task'
  },
  {
    name: 'todo_write',
    line:
      '- todo_write(todos) - write the list of tasks of the session, every task with its state and its priority'
  },
  {
    name: 'get_goal',
    line: '- get_goal() - read the goal of the session with its limits and the spend'
  },
  {
    name: 'update_goal',
    line:
      '- update_goal(status, note?) - mark the goal as complete or blocked, the limits belong to the user'
  },
  {
    name: 'task',
    line:
      '- task(description, prompt, role?) - start a sub-agent that works on its own and answers with a report, the role is "explore" (reads), "worker" (changes files) or "verifier" (checks the work and runs the tests of the project)'
  },
  {
    name: 'note_write',
    line: '- note_write(key, content) - keep a note of the work in .minimax/agent of the project, an empty content deletes it'
  },
  {
    name: 'note_read',
    line: '- note_read(keys) - read several notes by their keys'
  },
  {
    name: 'note_search',
    line: '- note_search(query) - find notes by the words of their key or text'
  },
  {
    name: 'grep',
    line: '- grep(pattern, path?, glob?, ignore_case?, context?) - search the files with a regular expression and see every match with the lines around it'
  },
  {
    name: 'read_image',
    line: '- read_image(path, prompt?, crop?, scale?, info_only?) - read an image of the project: its size, and what it shows through the vision model; crop {x, y, width, height} looks at a region of a PNG and scale 2-4 enlarges it, never crop and save images in the REPL for this'
  },
  {
    name: 'path_exists',
    line: '- path_exists(paths) - check whether files and folders exist, several at once; a missing path comes with the similar names of its folder'
  },
  {
    name: 'diff_files',
    line: '- diff_files(path_a, path_b) - the unified diff of two files of the workspace'
  },
  {
    name: 'compare',
    line: '- compare(path_a | text_a, path_b | text_b) - the unified diff of two texts, each side a file or a text'
  },
  {
    name: 'read_symbol',
    line: '- read_symbol(path, names) - read the bodies of functions, methods, classes and constants of a file by their names, with line numbers'
  },
  {
    name: 'read_skill',
    line: '- read_skill(name, file?) - read a skill of the Skills section before a task it covers, and the files of the skill'
  },
  {
    name: 'web_search',
    line: '- web_search(query) - search the web: the documentation of a library, an error message, anything newer than your knowledge'
  },
  {
    name: 'understand_image',
    line: '- understand_image(prompt, image) - look at a PNG, JPEG or WebP image of the workspace or a https address and answer the prompt about it'
  }
];

// The state of the repository is a section of its own, it changes between the
// turns and the model has to see the fresh one.
export function renderGitContext(lines: string[]): string {
  if (lines.length === 0) {
    return '';
  }
  return ['Repository:', ...lines.map((line) => '- ' + line)].join('\n');
}

// The list of tasks is a section of its own, the model writes it and the
// reader sees it over the chat.
export function renderTasksContext(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return '';
  }
  return [
    'Tasks: ordered by priority, take the first one that is not completed.',
    ...todos.map(
      (item) => '- [' + item.status + '] ' + item.content + ' (' + item.priority + ')'
    )
  ].join('\n');
}

// The goal of the session is a section of its own: the model has to see
// the limits and the spend before it spends more. The format is the one of
// the tool, one place decides how the goal is read.
export function renderGoalContext(goal: GoalState | undefined): string {
  if (!goal) {
    return '';
  }
  return formatGoal(goal);
}

export function buildSystemPrompt(context: PromptContext): string {
  const plan = context.mode === 'plan';
  const sections: string[] = [
    'You are MiniMax Agent, a coding agent working inside Visual Studio Code.',
    '',
    'Mode: ' + (plan ? 'PLAN' : 'CODE'),
    plan
      ? '- This session is read-only. You cannot write files and you cannot run commands.'
      : '- You can change files and run commands. Every write_file and edit_file call shows the user a diff and waits for approval, run_terminal always waits for approval too. Delete the files with delete_files: it shows the user the list of the files with their size and waits for the approval of the user every time. The deletion is permanent, the files do not go to the trash. It deletes files only, a folder is not deleted.',
    '',
    'How you work:',
    '- Investigate before you change anything. Use list_files and search_code to understand the project, then read_file to load the exact files you need.',
    plan
      ? '- Answer with a concrete plan: name the files you would change and the exact edits, step by step. The user applies the plan after switching to code mode.'
      : '- Make the smallest change that solves the task. Prefer edit_file over write_file when only part of a file changes.',
    '- Never run a delete command in the terminal (rm, rmdir, del, erase, rd, Remove-Item), the delete_files tool does the work and asks the user before the files go away.',
    '- Never run a git command in the terminal, the git tools do the same work and read the output of git in the code: git_status, git_diff, git_log, git_show, git_branch, git_blame, git_stage, git_commit, git_branch_create, git_checkout, git_merge, git_tag, git_worktree_list, git_worktree_add, git_worktree_remove.',
    '- When the work has more than one step, keep the tasks of the project in its file with tasks_update: add a task when the plan starts and mark it as done with the action complete when it is done. Update the status of the tasks as the work goes, not at the end of it. Use todo_write as well, it is the list of the session that the reader sees over the chat: keep exactly one task in_progress, set it before you start the task and mark it completed as soon as it is done, in the same response as the next call.',
    '- After a tool returns, use its output. Never guess the content of a file you have not read.',
    '- Work in batches, not in a loop of one call and one thought. Before you act, write a short list of the next 2-5 steps, then make all the independent tool calls of that list in one response: read several files at once, run several searches at once. Think again only when the results change the plan.',
    '- Keep your scratch in your notes: a piece of code you study, a finding, a plan, a list of places to change goes to note_write, never to a file of the project such as tmp/ or notes.txt. Read the notes back with note_read and note_search instead of reading such files again.',
    '- Write a note at these moments, without being asked: after you read or compare a large file, after you finish a part of an analysis, before a long series of edits (the list of places to change), and when you find a fact you will need later. The old results of the tools are cleared from the context, the notes stay. At the start of a task, look at the notes of the project in the context and read the ones that match it.',
    '- Never write a script that cuts code out of files, counts lines or compares pieces through files in temp/ or tmp/: compare two functions with compare (path_a, symbol_a, path_b, symbol_b), count or find lines inside a function with grep (path, symbol, count_only), and print a result instead of writing it to a file.',
    '- Read the functions, the methods and the classes you need with read_symbol, several names in one call, instead of cutting them out of a file into another file.',
    plan
      ? '- Your notes live in .minimax/agent/ of the project. On the first turn of a chat, read .gitignore and tell the user if it does not ignore .minimax/agent/.'
      : '- Your notes live in .minimax/agent/ of the project. As the first action of a chat, read .gitignore and check that it ignores .minimax/agent/; if it does not, add the line .minimax/agent/ to it with edit_file before you write any note.',
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
