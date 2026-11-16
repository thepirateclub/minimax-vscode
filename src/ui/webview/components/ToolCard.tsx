import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UiToolCall } from '../../protocol';
import {
  Chevron,
  IconCheck,
  IconEdit,
  IconGit,
  IconList,
  IconModel,
  IconRead,
  IconSearch,
  IconTerminal,
  IconWrite
} from '../icons';
import { STRINGS } from '../strings';
import { cardOpen } from '../toolCardState';
import { diffStats } from '../diffStats';
import { editDiff } from '../editDiff';
import { AgentView } from './AgentView';
import { TaskRows } from './TaskList';
import { todoItems } from '../todoItems';
import { DiffView } from './DiffView';
import { FileReadView } from './FileReadView';
import { TerminalView } from './TerminalView';
import { CopyButton } from './CopyButton';
import { formatInput } from '../toolText';
import { formatDuration } from '../../format';

interface ToolView {
  icon: ReactNode;
  title: string;
  summary: string;
}

function filePaths(input: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const single = input['path'];
  if (typeof single === 'string' && single.length > 0) {
    paths.push(single);
  }
  const many = input['paths'];
  if (Array.isArray(many)) {
    for (const item of many) {
      if (typeof item === 'string' && item.length > 0) {
        paths.push(item);
      }
    }
  }
  return paths;
}

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

function countLines(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  return value.split('\n').filter((line) => line.trim().length > 0).length;
}

function firstLine(value: string | undefined): string {
  if (!value) {
    return '';
  }
  const line = value.split('\n')[0] ?? '';
  return line.length > 60 ? line.slice(0, 60) + '…' : line;
}

// The card shows what the agent did, not the name of the tool.
// A folded card hides its body, so the header has to name the command.
function describe(tool: UiToolCall, folded: boolean): ToolView {
  const view = describeTool(tool, folded);
  const path = filePaths(tool.input)[0] ?? '';
  const result = (tool.content ?? '').split('\n')[0] ?? '';
  // The tool names the file in its result, the title of the card names it
  // already. The summary drops the echo and keeps the text of a failure.
  if (path.length > 0 && result.endsWith(path)) {
    return { ...view, summary: '' };
  }
  return view;
}

// The range of a read stands in the title, the reader sees which lines the
// agent has taken.
function readRange(input: Record<string, unknown>): string {
  const start = Number(input['start_line']);
  const end = Number(input['end_line']);
  const hasStart = Number.isFinite(start) && start >= 1;
  const hasEnd = Number.isFinite(end) && end >= 1;
  if (!hasStart && !hasEnd) {
    return '';
  }
  const first = hasStart ? Math.floor(start) : 1;
  if (!hasEnd) {
    return first + '+';
  }
  const last = Math.floor(end);
  return first === last ? String(first) : first + '-' + last;
}

function describeTool(tool: UiToolCall, folded: boolean): ToolView {
  const input = tool.input;
  const paths = filePaths(input);
  const content = tool.content;
  if (tool.name === 'read_file') {
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
  }
  if (tool.name === 'write_file') {
    return {
      icon: <IconWrite />,
      title: STRINGS.toolWrite + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'edit_file') {
    return {
      icon: <IconEdit />,
      title: STRINGS.toolEdit + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'search_code') {
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
  }
  if (tool.name === 'list_files') {
    const folder = text(input['path']) || '.';
    return {
      icon: <IconList />,
      title: STRINGS.toolList + ' ' + folder,
      summary: countLines(content) + ' ' + STRINGS.toolEntries
    };
  }
  if (tool.name === 'run_terminal') {
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
  }
  if (tool.name === 'git_status') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitStatus,
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_diff') {
    const staged = input['staged'] === true;
    return {
      icon: <IconGit />,
      title:
        STRINGS.toolGitDiff + (staged ? ' (' + STRINGS.toolGitStaged + ')' : ''),
      summary: countLines(content) + ' ' + STRINGS.toolLines
    };
  }
  if (tool.name === 'git_log') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitLog,
      summary: countLines(content) + ' ' + STRINGS.toolGitCommits
    };
  }
  if (tool.name === 'git_show') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitShow + ' ' + text(input['ref']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_merge') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitMerge + ' ' + text(input['branch']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_tag') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitTag + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_branch') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitBranch,
      summary: countLines(content) + ' ' + STRINGS.toolGitBranches
    };
  }
  if (tool.name === 'git_blame') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitBlame + ' ' + (paths[0] ?? ''),
      summary: countLines(content) + ' ' + STRINGS.toolLines
    };
  }
  if (tool.name === 'git_stage') {
    const title =
      paths.length > 1
        ? STRINGS.toolGitStage + ' ' + paths.length + ' ' + STRINGS.toolFiles
        : STRINGS.toolGitStage + ' ' + (paths[0] ?? '');
    return {
      icon: <IconGit />,
      title,
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_commit') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitCommit,
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_branch_create') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitBranchCreate + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_checkout') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitCheckout + ' ' + text(input['ref']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_worktree_list') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitWorktrees,
      summary: countLines(content) + ' ' + STRINGS.toolGitWorktreeCount
    };
  }
  if (tool.name === 'git_worktree_add') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitWorktreeAdd + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'git_worktree_remove') {
    return {
      icon: <IconGit />,
      title: STRINGS.toolGitWorktreeRemove + ' ' + (paths[0] ?? ''),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'tasks_read') {
    return {
      icon: <IconList />,
      title: STRINGS.toolTasksRead,
      summary: countLines(content) + ' ' + STRINGS.toolLines
    };
  }
  if (tool.name === 'tasks_update') {
    const action = text(input['action']);
    return {
      icon: <IconList />,
      title:
        STRINGS.toolTasksUpdate +
        (action.length > 0 ? ' (' + action + ')' : ''),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'repl_node' || tool.name === 'repl_python') {
    return {
      icon: <IconTerminal />,
      title:
        tool.name === 'repl_node' ? STRINGS.toolReplNode : STRINGS.toolReplPython,
      summary: firstLine(content)
    };
  }
  if (tool.name === 'container_list') {
    return {
      icon: <IconList />,
      title: STRINGS.toolContainers,
      summary: countLines(content) + ' ' + STRINGS.toolEntries
    };
  }
  if (tool.name === 'container_logs') {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerLogs + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'container_run') {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerRun + ' ' + text(input['image']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'container_stop') {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerStop + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'container_exec') {
    return {
      icon: <IconTerminal />,
      title: STRINGS.toolContainerExec + ' ' + text(input['name']),
      summary: firstLine(content)
    };
  }
  if (tool.name === 'run_cmd') {
    const command = text(input['command']);
    const failed = /exit code (\d+)/.exec(content ?? '');
    return {
      icon: <IconTerminal />,
      title: folded ? STRINGS.toolCmd + ' ' + command : STRINGS.toolCmd,
      summary: failed ? STRINGS.toolExitCode + ' ' + failed[1] : ''
    };
  }
  if (tool.name === 'task') {
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
  }
  if (tool.name === 'todo_write') {
    const todos = todoItems(input['todos']);
    const done = todos.filter((item) => item.status === 'completed').length;
    return {
      icon: <IconList />,
      title: STRINGS.toolTodo,
      summary: tool.isError
        ? firstLine(content)
        : done + '/' + todos.length + ' ' + STRINGS.toolTodoDone
    };
  }
  if (tool.name === 'get_goal') {
    return { icon: <IconCheck />, title: STRINGS.toolGetGoal, summary: '' };
  }
  if (tool.name === 'update_goal') {
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
  }
  return {
    icon: <IconRead />,
    title: tool.name,
    summary: firstLine(content)
  };
}

export function ToolCard({
  tool,
  collapsed
}: {
  tool: UiToolCall;
  // The setting folds the card, only the title stays until a click.
  collapsed: boolean;
}) {
  const verbose = (tool.content?.length ?? 0) > 400;
  // The state of the card follows the setting. A click of the reader is kept
  // as an override, so the card does not fight with the hand of the reader.
  const [override, setOverride] = useState<boolean | null>(null);
  const open = cardOpen(collapsed, verbose, override);
  // A write without a change has nothing to show, the plain result stays.
  const diff = tool.diff && tool.diff.lines.length > 0 ? tool.diff : undefined;
  // The chats of the old sessions keep the arguments of an edit, not its diff.
  // The panel still shows what the edit did.
  const fallback = diff ? undefined : editDiff(tool);
  const changes =
    diff ??
    (fallback ? { path: filePaths(tool.input)[0] ?? '', lines: fallback } : undefined);
  // The header shows the size of the change, the body shows the change itself.
  // An empty half stays out, a zero in red looks like a mistake.
  const stats = changes ? diffStats(changes.lines) : { added: 0, removed: 0 };
  const statsLabel = [
    stats.added > 0 ? stats.added + ' ' + STRINGS.toolAdded : '',
    stats.removed > 0 ? stats.removed + ' ' + STRINGS.toolRemoved : ''
  ]
    .filter((part) => part.length > 0)
    .join(', ');
  const status = tool.running
    ? STRINGS.toolRunning
    : tool.isError
      ? STRINGS.toolFailed
      : STRINGS.toolDone;
  const view = describe(tool, !open);
  // A tool without arguments has nothing to show, an empty block reads
  // like a panel that failed to open.
  const inputText = formatInput(tool.input);
  return (
    <div
      className={
        'tool-card' + (tool.isError ? ' tool-error' : '') + (tool.running ? ' tool-running' : '')
      }
    >
      <button className="tool-head" aria-expanded={open} onClick={() => setOverride(!open)}>
        <Chevron open={open} />
        <span className="tool-icon">{view.icon}</span>
        <span className="tool-title">{view.title}</span>
        <span className="tool-summary">{view.summary}</span>
        {statsLabel.length > 0 ? (
          <span className="tool-stats" title={statsLabel}>
            {stats.added > 0 ? (
              <span className="tool-stat tool-stat-add">+{stats.added}</span>
            ) : null}
            {stats.removed > 0 ? (
              <span className="tool-stat tool-stat-remove">-{stats.removed}</span>
            ) : null}
          </span>
        ) : null}
        <span className="tool-tail">
          {tool.durationMs !== undefined ? (
            <span className="tool-time" title={STRINGS.toolElapsed}>
              {formatDuration(tool.durationMs)}
            </span>
          ) : null}
          <span
            className={
              'tool-dot tool-dot-' +
              (tool.running ? 'running' : tool.isError ? 'failed' : 'done')
            }
            title={status}
            aria-label={status}
          />
        </span>
      </button>
      {open ? (
        <div className="tool-body">
          {changes ? (
            <DiffView path={changes.path} lines={changes.lines} showPath={false} />
          ) : tool.name === 'read_file' && tool.content ? (
            <FileReadView content={tool.content} path={filePaths(tool.input)[0] ?? ''} />
          ) : tool.name === 'run_terminal' || tool.name === 'run_cmd' ? (
            <TerminalView
              command={String(tool.input['command'] ?? '')}
              content={tool.content ?? ''}
              running={tool.running === true}
            />
          ) : tool.name === 'todo_write' && !tool.isError ? (
            <TaskRows todos={todoItems(tool.input['todos'])} />
          ) : tool.name === 'update_goal' && !tool.isError ? (
            text(tool.input['note']).length > 0 ? (
              <p className="tool-note">{text(tool.input['note'])}</p>
            ) : null
          ) : tool.name === 'task' ? (
            <AgentView
              progress={tool.progress ?? []}
              content={tool.content ?? ''}
            />
          ) : (
            <>
              {inputText.length > 0 ? (
                <pre className="tool-input">{inputText}</pre>
              ) : null}
              {tool.content ? (
                <div className="tool-output-wrap">
                  <CopyButton text={tool.content} />
                  <pre className="tool-output">{tool.content}</pre>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
