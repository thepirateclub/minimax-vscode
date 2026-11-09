import { useState } from 'react';
import type { UiToolCall } from '../../protocol';
import { STRINGS } from '../strings';

function summarize(input: Record<string, unknown>): string {
  const path = input['path'];
  if (typeof path === 'string' && path.length > 0) {
    return path;
  }
  const command = input['command'];
  if (typeof command === 'string' && command.length > 0) {
    return command.length > 48 ? command.slice(0, 48) + '…' : command;
  }
  const query = input['query'];
  if (typeof query === 'string' && query.length > 0) {
    return query;
  }
  return '';
}

export function ToolCard({ tool }: { tool: UiToolCall }) {
  const verbose = (tool.content?.length ?? 0) > 400;
  const [open, setOpen] = useState(!verbose);
  const status = tool.running
    ? STRINGS.toolRunning
    : tool.isError
      ? STRINGS.toolFailed
      : STRINGS.toolDone;
  const summary = summarize(tool.input);
  return (
    <div
      className={
        'tool-card' + (tool.isError ? ' tool-error' : '') + (tool.running ? ' tool-running' : '')
      }
    >
      <button className="tool-head" onClick={() => setOpen((value) => !value)}>
        <span className="tool-caret">{open ? '▾' : '▸'}</span>
        <span className="tool-name">{tool.name}</span>
        {summary ? <span className="tool-summary">{summary}</span> : null}
        <span className={'tool-status' + (tool.isError ? ' failed' : '')}>{status}</span>
      </button>
      {open ? (
        <div className="tool-body">
          <pre className="tool-input">{JSON.stringify(tool.input, null, 2)}</pre>
          {tool.content ? <pre className="tool-output">{tool.content}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
