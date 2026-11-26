// The scope of a grant of the reader. "Always allow" granted the whole tool:
// one click on npm test allowed every command of the terminal. A grant now
// has a scope: the prefix of a command, the folder of a write, the tool for
// the rest. A rule is a string, the same form lives in minimax.autoApprove:
// `run_terminal(npm test)`, `write_file(src/ui/)`, or a bare name of a tool
// for the whole tool, the form of the older settings.

const COMMAND_TOOLS = ['run_terminal', 'run_cmd'];
const WRITE_TOOLS = ['write_file', 'edit_file'];
// A runner takes its subcommand with it: `npm test` and `npm install` are
// two different grants.
const RUNNERS = new Set([
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'node', 'deno', 'cargo', 'go', 'dotnet',
  'python', 'python3', 'py', 'pip', 'uv', 'poetry', 'make', 'mvn', 'gradle', 'gradlew'
]);
// A chained or redirected command never rides on a prefix: `npm test && rm`
// would pass a rule of `npm test` otherwise.
const SHELL_OPERATORS = /[;&|`<>\r\n]|\$\(/;

// The tools that ask the reader every time. A rule of the reader never
// covers them: the deletion of a file is never silent. The list lives here
// because the panel and the host read it without the tools of the extension.
export const ALWAYS_CONFIRM_TOOLS = ['delete_files', 'git_worktree_remove'];

export function alwaysConfirms(toolName: string, input?: Record<string, unknown>): boolean {
  if (ALWAYS_CONFIRM_TOOLS.includes(toolName)) {
    return true;
  }
  // A git command that throws work away has no tool of its own and runs in
  // the shell. A rule of the reader (even a bare run_terminal) must not let
  // it pass silently: the loss cannot be undone.
  return COMMAND_TOOLS.includes(toolName) && input !== undefined && destroysGitWork(String(input['command'] ?? ''));
}

// The global flags of git that take a value.
const GIT_VALUE_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

// True for git clean -f, reset --hard, push --force, stash drop or clear,
// branch -D, checkout or restore of paths, reflog expire, filter-branch.
export function destroysGitWork(command: string): boolean {
  for (const segment of command.split(/&&|\|\||;|\||\r?\n/)) {
    const words = tokens(segment);
    let index = words.findIndex((word) => /(^|[\\/])git(\.exe)?$/i.test(word));
    if (index === -1) {
      continue;
    }
    index += 1;
    while ((words[index] ?? '').startsWith('-')) {
      index += GIT_VALUE_FLAGS.has(words[index]!) ? 2 : 1;
    }
    const sub = words[index];
    const rest = words.slice(index + 1);
    const has = (...flags: string[]): boolean => rest.some((word) => flags.includes(word));
    const short = (letter: string): boolean => rest.some((word) => /^-[a-zA-Z]+$/.test(word) && word.includes(letter));
    if (
      (sub === 'clean' && (has('--force') || short('f'))) ||
      (sub === 'reset' && has('--hard', '--merge', '--keep')) ||
      (sub === 'push' && (has('--force', '--force-with-lease', '--mirror', '--delete') || short('f') || short('d') || rest.some((word) => word.startsWith('+') || word.startsWith(':') || word.startsWith('--force')))) ||
      (sub === 'stash' && has('drop', 'clear')) ||
      (sub === 'branch' && (short('D') || (has('--delete', '-d') && has('--force', '-f')))) ||
      (sub === 'checkout' && (has('--', '.', '-f', '--force'))) ||
      sub === 'restore' ||
      sub === 'rebase' ||
      (sub === 'commit' && has('--amend')) ||
      sub === 'filter-branch' ||
      (sub === 'reflog' && has('expire', 'delete')) ||
      (sub === 'update-ref' && has('-d'))
    ) {
      return true;
    }
  }
  return false;
}

export function ruleFor(toolName: string, input: Record<string, unknown>): string {
  if (COMMAND_TOOLS.includes(toolName)) {
    const prefix = commandPrefix(String(input['command'] ?? ''));
    return prefix.length > 0 ? toolName + '(' + prefix + ')' : toolName;
  }
  if (WRITE_TOOLS.includes(toolName)) {
    const folder = folderOf(String(input['path'] ?? ''));
    return folder ? toolName + '(' + folder + ')' : toolName;
  }
  return toolName;
}

export function ruleAllows(rule: string, toolName: string, input: Record<string, unknown>): boolean {
  const open = rule.indexOf('(');
  const name = open === -1 ? rule : rule.slice(0, open);
  if (name !== toolName) {
    return false;
  }
  if (open === -1 || !rule.endsWith(')')) {
    return open === -1;
  }
  const scope = rule.slice(open + 1, -1);
  if (COMMAND_TOOLS.includes(toolName)) {
    const command = String(input['command'] ?? '');
    if (SHELL_OPERATORS.test(command)) {
      return false;
    }
    const words = tokens(command);
    const wanted = tokens(scope);
    return wanted.length > 0 && wanted.every((word, index) => words[index] === word);
  }
  if (WRITE_TOOLS.includes(toolName)) {
    const path = normalized(String(input['path'] ?? ''));
    if (path === undefined) {
      return false;
    }
    return scope === './' ? !path.includes('/') : path.startsWith(scope);
  }
  return false;
}

// The words of the button of the approval card.
export function scopeLabel(toolName: string, input: Record<string, unknown>): string {
  if (COMMAND_TOOLS.includes(toolName)) {
    const prefix = commandPrefix(String(input['command'] ?? ''));
    if (prefix.length > 0) {
      return 'Always allow "' + prefix + '"';
    }
  }
  if (WRITE_TOOLS.includes(toolName)) {
    const folder = folderOf(String(input['path'] ?? ''));
    if (folder) {
      const action = toolName === 'edit_file' ? 'edits' : 'writes';
      return 'Always allow ' + action + ' in ' + (folder === './' ? 'the root' : folder);
    }
  }
  return 'Always allow in this session';
}

function commandPrefix(command: string): string {
  if (SHELL_OPERATORS.test(command)) {
    return '';
  }
  const words = tokens(command);
  const first = words[0];
  if (first === undefined) {
    return '';
  }
  const second = words[1];
  return RUNNERS.has(first.toLowerCase()) && second !== undefined ? first + ' ' + second : first;
}

// The folder of a file relative to the workspace, with a slash at the end so
// `src/ui/` does not match `src/uix/`. A path out of the workspace has none.
function folderOf(path: string): string | undefined {
  const file = normalized(path);
  if (file === undefined) {
    return undefined;
  }
  const slash = file.lastIndexOf('/');
  return slash === -1 ? './' : file.slice(0, slash + 1);
}

// The path in the form of the workspace: forward slashes, no `.` and `..`.
// The module runs in the panel too, so it has no node:path.
function normalized(path: string): string | undefined {
  const raw = path.trim().replace(/\\/g, '/');
  if (raw.length === 0 || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const part of raw.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (parts.length === 0) {
        return undefined;
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.length > 0 ? parts.join('/') : undefined;
}

function tokens(text: string): string[] {
  return text.trim().split(/\s+/).filter((word) => word.length > 0);
}
