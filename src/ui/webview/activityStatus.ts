import type { UiMessage, UiToolCall } from '../protocol';

export interface ActiveAction {
  // The name of the tool, the reader sees what the agent calls.
  name: string;
  // What the tool does, in words of the reader.
  detail: string;
  // The object of the action: a path, a command, a query.
  target: string;
}

// What every tool of the agent does, in words of the reader. The name of the
// tool alone says little to a person who does not know the tools.
const DETAILS: Record<string, string> = {
  read_file: 'reads a file',
  write_file: 'writes a file',
  edit_file: 'changes a file',
  search_code: 'searches the code',
  list_files: 'lists the files',
  run_terminal: 'runs a command',
  run_cmd: 'runs a command',
  repl_node: 'runs a script',
  repl_python: 'runs a script',
  git_status: 'reads the state of the repository',
  git_diff: 'shows the changes',
  git_log: 'reads the history',
  git_show: 'shows a commit',
  git_branch: 'reads the branches',
  git_blame: 'reads the history of a line',
  git_stage: 'stages the changes',
  git_commit: 'makes a commit',
  git_branch_create: 'creates a branch',
  git_checkout: 'switches the branch',
  git_merge: 'merges the branches',
  git_tag: 'works with the tags',
  git_worktree_list: 'reads the worktrees',
  git_worktree_add: 'adds a worktree',
  git_worktree_remove: 'removes a worktree',
  task: 'runs a sub agent',
  todo_write: 'updates the tasks',
  tasks_read: 'reads the tasks',
  tasks_update: 'updates the tasks',
  get_goal: 'reads the goal',
  update_goal: 'updates the goal',
  container_list: 'lists the containers',
  container_logs: 'reads the logs of a container',
  container_run: 'runs a container',
  container_stop: 'stops a container',
  container_exec: 'runs a command in a container'
};

// The action of the agent that runs now. The panel keeps the cards of the
// actions, the card of a running tool is marked, so the live status of the
// agent is known without a new message from the host.
export function activeAction(messages: UiMessage[]): ActiveAction | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tool = messages[i]?.tool;
    if (tool?.running) {
      return {
        name: tool.name,
        detail: DETAILS[tool.name] ?? 'runs the tool',
        target: targetOf(tool)
      };
    }
  }
  return undefined;
}

// The object of the action: the file, the command, the query of the tool.
function targetOf(tool: UiToolCall): string {
  const input = tool.input ?? {};
  for (const key of ['path', 'command', 'query', 'ref', 'branch', 'description']) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  const patterns = input['patterns'];
  if (Array.isArray(patterns) && patterns.length > 0) {
    return patterns.map((item) => String(item)).join(' ');
  }
  return '';
}
