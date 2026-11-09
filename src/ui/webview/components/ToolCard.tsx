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
function describe(tool: UiToolCall): ToolView {
  const input = tool.input;
  const paths = filePaths(input);
  const content = tool.content;
  if (tool.name === 'read_file') {
    const title =
      paths.length > 1
        ? STRINGS.toolRead + ' ' + paths.length + ' ' + STRINGS.toolFiles
        : STRINGS.toolRead + ' ' + (paths[0] ?? '');
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
      title: STRINGS.toolTerminal + ' ' + command,
      summary: failed
        ? STRINGS.toolExitCode + ' ' + failed[1]
        : firstLine(content)
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

export function ToolCard({ tool }: { tool: UiToolCall }) {
  const verbose = (tool.content?.length ?? 0) > 400;
  const [open, setOpen] = useState(!verbose);
  const status = tool.running
    ? STRINGS.toolRunning
    : tool.isError
      ? STRINGS.toolFailed
      : STRINGS.toolDone;
  const view = describe(tool);
  return (
    <div
      className={
        'tool-card' + (tool.isError ? ' tool-error' : '') + (tool.running ? ' tool-running' : '')
      }
    >
      <button className="tool-head" onClick={() => setOpen((value) => !value)}>
        <span className="tool-caret">{open ? '▾' : '▸'}</span>
        <span className="tool-icon">{view.icon}</span>
        <span className="tool-title">{view.title}</span>
        <span className="tool-summary">{view.summary}</span>
        {tool.durationMs !== undefined ? (
          <span className="tool-time">
            {tool.durationMs} {STRINGS.toolElapsed}
          </span>
        ) : null}
        <span className={'tool-status' + (tool.isError ? ' failed' : '')}>{status}</span>
      </button>
      {open ? (
        <div className="tool-body">
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
        </div>
      ) : null}
    </div>
  );
}
