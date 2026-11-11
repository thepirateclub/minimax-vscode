import { renderMarkdown } from '../markdown';

// The card of a sub-agent: the journal of the child on the top, the
// answer of the child under it.
export function AgentView({
  progress,
  content
}: {
  progress: string[];
  content: string;
}) {
  return (
    <>
      {progress.length > 0 ? (
        <div className="agent-log">
          {progress.map((line, index) => (
            <div key={index} className="agent-log-line">
              {line}
            </div>
          ))}
        </div>
      ) : null}
      <div
        className="markdown agent-answer"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
      />
    </>
  );
}
