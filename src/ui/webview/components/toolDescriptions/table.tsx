import type { ReactNode } from 'react';
import type { UiToolCall } from '../../../protocol';
import { STRINGS } from '../../strings';
import { todoItems } from '../../todoItems';
import { countLines, firstLine, readRange, text } from '../toolCardHelpers';
import {
  IconCheck,
  IconEdit,
  IconGit,
  IconList,
  IconModel,
  IconRead,
  IconSearch,
  IconTerminal,
  IconWrite,
} from '../../icons';

export interface ToolView {
  icon: ReactNode;
  title: string;
  summary: string;
}

// One describer for every tool of the panel: the name of the tool picks
// the row, a new tool is one row of this table and not another branch of
// a long chain of if.
export interface DescriberContext {
  tool: UiToolCall;
  input: Record<string, unknown>;
  paths: string[];
  content: string | undefined;
  folded: boolean;
}

export type Describer = (ctx: DescriberContext) => ToolView;

// The REPL of node and the REPL of python are the same card, only the
// name of the language differs. Both rows point at one describer.
const REPL_TITLES: Record<string, string> = {
  repl_node: STRINGS.toolReplNode,
  repl_python: STRINGS.toolReplPython
};

const replDescriber: Describer = ({ tool, content }) => ({
  icon: <IconTerminal />,
  // An unknown REPL keeps its own name: the card must not call a language
  // that it does not know.
  title: REPL_TITLES[tool.name] ?? tool.name,
  summary: firstLine(content)
});

// The names of the tools the panel knows. A tool without a row here falls
// to the generic card, so the list is worth checking against the tools of
// the extension.
export function describerNames(): string[] {
  return Object.keys(DESCRIBERS);
}

export const DESCRIBERS: Record<string, Describer> = {
  // The range of a read stands in the title, the reader sees which lines
  // the agent has taken.
  read_file: ({ input, paths, content }) => {
    const range = readRange(input);
    const suffix = range.length > 0 ? ' ' + range : '';
    const title =
      paths.length > 1
        ? STRINGS.toolRead + ' ' + paths.length + ' ' + STRINGS.toolFiles + suffix
        : STRINGS.toolRead + ' ' + (paths[0] ?? '') + suffix;
    return {
      icon: <IconRead />,
      title,
      summary: countLines(content) + ' ' + STRINGS.toolLines
    };
  },
  write_file: ({ paths, content }) => {
    return {
      icon: <IconWrite />,
      title: STRINGS.toolWrite + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  },
  edit_file: ({ paths, content }) => {
    return {
      icon: <IconEdit />,
      title: STRINGS.toolEdit + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  },
  search_code: ({ input, content }) => {
    // The patterns replace the query, the card names them as they are.
    const many = input['patterns'];
    const patterns = Array.isArray(many)
      ? many.filter((item): item is string => typeof item === 'string')
      : [];
    const shown = patterns.length > 0 ? patterns.join(' ') : text(input['query']);
    const noMatch = (content ?? '').startsWith('No matches');
    return {
      icon: <IconSearch />,
      title: STRINGS.toolSearch + ' "' + shown + '"',
      summary: noMatch ? '0 ' + STRINGS.toolMatches : countLines(content) + ' ' + STRINGS.toolMatches
    };
  },
  list_files: ({ input, content }) => {
    const folder = text(input['path']) || '.';
    return {
      icon: <IconList />,
      title: STRINGS.toolList + ' ' + folder,
      summary: countLines(content) + ' ' + STRINGS.toolEntries
    };
  },
  run_terminal: ({ input, content, folded }) => {
    const command = text(input['command']);
    const failed = /exit code (\d+)/.exec(content ?? '');
    return {
      icon: <IconTerminal />,
      // The command stands in the terminal block. The header repeats it
      // only while the card is folded and the block is hidden.
      title: folded ? STRINGS.toolTerminal + ' ' + command : STRINGS.toolTerminal,
      // The output speaks for itself, the summary keeps only the failure.
      summary: failed ? STRINGS.toolExitCode + ' ' + failed[1] : ''
    };
  },
  git_status: ({ content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitStatus,
      summary: firstLine(content)
    };
  },
  git_diff: ({ input, content }) => {
    const staged = input['staged'] === true;
    return {
      icon: <IconGit />,
      title:
        STRINGS.toolGitDiff + (staged ? ' (' + STRINGS.toolGitStaged + ')' : ''),
      summary: countLines(content) + ' ' + STRINGS.toolLines
    };
  },
  git_log: ({ content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitLog,
      summary: countLines(content) + ' ' + STRINGS.toolGitCommits
    };
  },
  git_show: ({ input, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitShow + ' ' + text(input['ref']),
      summary: firstLine(content)
    };
  },
  git_merge: ({ input, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitMerge + ' ' + text(input['branch']),
      summary: firstLine(content)
    };
  },
  git_tag: ({ input, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitTag + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  },
  git_branch: ({ content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitBranch,
      summary: countLines(content) + ' ' + STRINGS.toolGitBranches
    };
  },
  git_blame: ({ paths, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitBlame + ' ' + (paths[0] ?? ''),
      summary: countLines(content) + ' ' + STRINGS.toolLines
    };
  },
  git_stage: ({ paths, content }) => {
    const title =
      paths.length > 1
        ? STRINGS.toolGitStage + ' ' + paths.length + ' ' + STRINGS.toolFiles
        : STRINGS.toolGitStage + ' ' + (paths[0] ?? '');
    return {
      icon: <IconGit />,
      title,
      summary: firstLine(content)
    };
  },
  git_commit: ({ content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitCommit,
      summary: firstLine(content)
    };
  },
  git_branch_create: ({ input, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitBranchCreate + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  },
  git_checkout: ({ input, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitCheckout + ' ' + text(input['ref']),
      summary: firstLine(content)
    };
  },
  git_worktree_list: ({ content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitWorktrees,
      summary: countLines(content) + ' ' + STRINGS.toolGitWorktreeCount
    };
  },
  git_worktree_add: ({ paths, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitWorktreeAdd + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  },
  git_worktree_remove: ({ paths, content }) => {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitWorktreeRemove + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  },
  tasks_read: ({ content }) => {
    return {
      icon: <IconList />,
      title: STRINGS.toolTasksRead,
      summary: countLines(content) + ' ' + STRINGS.toolLines
    };
  },
  tasks_update: ({ input, content }) => {
    const action = text(input['action']);
    return {
      icon: <IconList />,
      title:
        STRINGS.toolTasksUpdate +
        (action.length > 0 ? ' (' + action + ')' : ''),
      summary: firstLine(content)
    };
  },
  repl_node: replDescriber,
  repl_python: replDescriber,
  container_list: ({ content }) => {
    return {
      icon: <IconList />,
      title: STRINGS.toolContainers,
      summary: countLines(content) + ' ' + STRINGS.toolEntries
    };
  },
  container_logs: ({ input, content }) => {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerLogs + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  },
  container_run: ({ input, content }) => {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerRun + ' ' + text(input['image']),
      summary: firstLine(content)
    };
  },
  container_stop: ({ input, content }) => {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerStop + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  },
  container_exec: ({ input, content }) => {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerExec + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  },
  run_cmd: ({ input, content, folded }) => {
    const command = text(input['command']);
    const failed = /exit code (\d+)/.exec(content ?? '');
    return {
      icon: <IconTerminal />,
      title: folded ? STRINGS.toolCmd + ' ' + command : STRINGS.toolCmd,
      summary: failed ? STRINGS.toolExitCode + ' ' + failed[1] : ''
    };
  },
  task: ({ tool, content, folded }) => {
    const description = text(tool.input['description']);
    const role = text(tool.input['role']);
    return {
      icon: <IconModel />,
      title:
        STRINGS.toolTask +
        (description.length > 0 ? ' ' + description : '') +
        (role.length > 0 ? ' (' + role + ')' : ''),
      // An open card shows the answer of the child right under the title,
      // the summary would print it twice.
      summary: folded || tool.isError ? firstLine(content) : ''
    };
  },
  todo_write: ({ tool, input, content }) => {
    const todos = todoItems(input['todos']);
    const done = todos.filter((item) => item.status === 'completed').length;
    return {
      icon: <IconList />,
      title: STRINGS.toolTodo,
      summary: tool.isError
        ? firstLine(content)
        : done + '/' + todos.length + ' ' + STRINGS.toolTodoDone
    };
  },
  get_goal: ({}) => {
    return { icon: <IconCheck />, title: STRINGS.toolGetGoal, summary: '' };
  },
  update_goal: ({ tool, input, content, folded }) => {
    const status = text(input['status']);
    return {
      icon: <IconCheck />,
      title:
        status === 'complete'
          ? STRINGS.toolGoalComplete
          : status === 'blocked'
            ? STRINGS.toolGoalBlocked
            : STRINGS.toolUpdateGoal,
      // The result speaks to the model, the reader gets the note. An open
      // card shows the whole note in its body, the summary would repeat it.
      summary: tool.isError
        ? firstLine(content)
        : folded
          ? firstLine(text(input['note']))
          : ''
    };
  },
};
