import type { UiDiffLine } from '../../protocol';

export function DiffView({ path, lines }: { path: string; lines: UiDiffLine[] }) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="diff">
      <div className="diff-path">{path}</div>
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
