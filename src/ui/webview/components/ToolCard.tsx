import type { UiToolCall } from '../../protocol';
import { STRINGS } from '../strings';

export function ToolCard({ tool }: { tool: UiToolCall }) {
  const status = tool.running
    ? STRINGS.toolRunning
    : tool.isError
      ? STRINGS.toolFailed
      : STRINGS.toolDone;
  return (
    <div className={'tool-card' + (tool.isError ? ' tool-error' : '')}>
      <div className="tool-head">
        <span className="tool-name">{tool.name}</span>
        <span className="tool-status">{status}</span>
      </div>
      <pre className="tool-input">{JSON.stringify(tool.input, null, 2)}</pre>
      {tool.content ? <pre className="tool-output">{tool.content}</pre> : null}
    </div>
  );
}
