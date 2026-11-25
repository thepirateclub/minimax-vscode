import { renderMarkdown } from '../markdown';
import { parseAgentLog, type AgentLogRow } from '../agentLog';
import { STRINGS } from '../strings';
import { describe } from './toolDescriptions';
import { formatDuration, formatStamp, fullStamp } from '../../format';

// The card of a sub-agent: the actions of the child on the top, the answer
// of the child under it. The actions are the rows of the feed in small: the
// icon and the word of the card, the object, the size of a change and the
// dot of the state. They stand on a guide line, the work of the child is
// nested in the card of the parent and does not look like its own actions.
export function AgentView({
  progress,
  content
}: {
  progress: string[];
  content: string;
}) {
  const rows = parseAgentLog(progress);
  return (
    <>
      {rows.length > 0 ? (
        <ol className="agent-log">
          {rows.map((row, index) => (
            <AgentLogItem key={index} row={row} />
          ))}
        </ol>
      ) : null}
      <div
        className="markdown agent-answer"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    </>
  );
}

function AgentLogItem({ row }: { row: AgentLogRow }) {
  // The title of the card: the same describer as a card of the parent,
  // folded, so a command stands in the title. An old chat has no input,
  // its target stands in for the fields that name an action.
  const input = row.input ?? { path: row.target, query: row.target, command: row.target };
  const view =
    row.name.length > 0 ? describe({ id: '', name: row.name, input }, true) : undefined;
  const status =
    row.state === 'running'
      ? STRINGS.toolRunning
      : row.state === 'failed'
        ? STRINGS.toolFailed
        : STRINGS.toolDone;
  return (
    // A point of the timeline, the same as a card of the group of actions:
    // the node on the guide line carries the state, the tail the moment.
    <li
      className={
        'agent-log-row timeline-item timeline-' + row.state +
        (row.state === 'failed' ? ' agent-log-failed' : '')
      }
    >
      <span className="timeline-node" aria-hidden="true" />
      {view ? <span className="tool-icon">{view.icon}</span> : null}
      <span className="agent-log-title" title={view?.title}>
        {view ? view.title : STRINGS.toolFailed}
      </span>
      {view ? null : <span className="agent-log-target">{row.target}</span>}
      {row.added > 0 ? <span className="tool-stat tool-stat-add">+{row.added}</span> : null}
      {row.removed > 0 ? (
        <span className="tool-stat tool-stat-remove">-{row.removed}</span>
      ) : null}
      <span className="tool-tail">
        {row.at !== undefined ? (
          <span className="tool-stamp" title={STRINGS.startedAt + ' ' + fullStamp(row.at)}>
            {formatStamp(row.at)}
          </span>
        ) : null}
        {row.durationMs !== undefined ? (
          <span className="tool-time" title={STRINGS.toolElapsed}>
            {formatDuration(row.durationMs)}
          </span>
        ) : null}
        <span
          className={'tool-dot tool-dot-' + row.state}
          title={status}
          aria-label={status}
        />
      </span>
    </li>
  );
}
