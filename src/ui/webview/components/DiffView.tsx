import type { UiDiffLine } from '../../protocol';

export function DiffView({
  path,
  lines,
  showPath = true
}: {
  path: string;
  lines: UiDiffLine[];
  // The card of an action names the file in its title, the path is noise there.
  showPath?: boolean;
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="diff">
      {showPath ? <div className="diff-path">{path}</div> : null}
      <pre className="diff-body">
        {lines.map((line, index) => (
          <div key={index} className={'diff-line diff-' + line.type}>
            <span className="diff-marker">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            {line.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
