import { useState } from 'react';
import type { ReactNode } from 'react';
import type { UiToolCall } from '../../protocol';
import {
  IconCopy,
  IconEdit,
  IconList,
  IconRead,
  IconSearch,
  IconTerminal,
  IconWrite
} from '../icons';
import { STRINGS } from '../strings';
import { cardOpen } from '../toolCardState';
import { diffStats } from '../diffStats';
import { editDiff } from '../editDiff';
import { DiffView } from './DiffView';
import { FileReadView } from './FileReadView';
import { TerminalView } from './TerminalView';

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
    const query = text(input['query']);
    const noMatch = (content ?? '').startsWith('No matches');
    return {
      icon: <IconSearch />,
      title: STRINGS.toolSearch + ' "' + query + '"',
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
  return {
    icon: <IconRead />,
    title: tool.name,
    summary: firstLine(content)
  };
}

// The arguments are shown as a short list, not as a json dump.
function formatInput(input: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const shown = text(value);
    if (shown.length === 0) {
      continue;
    }
    lines.push(key + ': ' + (shown.length > 200 ? shown.slice(0, 200) + '…' : shown));
  }
  return lines.join('\n');
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
  return (
    <div
      className={
        'tool-card' + (tool.isError ? ' tool-error' : '') + (tool.running ? ' tool-running' : '')
      }
    >
      <button className="tool-head" onClick={() => setOverride(!open)}>
        <span className="tool-caret">{open ? '▾' : '▸'}</span>
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
            <span className="tool-time">
              {tool.durationMs} {STRINGS.toolElapsed}
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
          ) : tool.name === 'run_terminal' ? (
            <TerminalView
              command={String(tool.input['command'] ?? '')}
              content={tool.content ?? ''}
              running={tool.running === true}
            />
          ) : (
            <>
              <pre className="tool-input">{formatInput(tool.input)}</pre>
              {tool.content ? (
                <div className="tool-output-wrap">
                  <button
                    className="tool-copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(tool.content ?? '');
                    }}
                  >
                    <IconCopy />
                    {STRINGS.copy}
                  </button>
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
