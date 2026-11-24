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
