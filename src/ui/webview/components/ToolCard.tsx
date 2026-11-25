import { useState } from 'react';
import type { UiToolCall } from '../../protocol';
import {
  Chevron,
} from '../icons';
import { STRINGS } from '../strings';
import { cardOpen, formatInput } from '../toolCard';
import { diffStats } from '../diffStats';
import { editDiff } from '../editDiff';
import { AgentView } from './AgentView';
import { TaskRows } from './TaskList';
import { todoItems } from '../todoItems';
import { DiffView } from './DiffView';
import { FileReadView } from './FileReadView';
import { TerminalView } from './TerminalView';
import { CopyButton } from './CopyButton';
import { formatDuration, formatStamp, fullStamp } from '../../format';
import { describe } from './toolDescriptions';
import { filePaths, text } from './toolCardHelpers';

export function ToolCard({
  tool,
  collapsed,
  at
}: {
  tool: UiToolCall;
  // When the action started, the card names the moment.
  at?: number;
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
          {at !== undefined ? (
            <span className="tool-stamp" title={STRINGS.startedAt + ' ' + fullStamp(at)}>
              {formatStamp(at)}
            </span>
          ) : null}
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
