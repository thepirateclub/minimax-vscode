import type { UiChangedFile } from '../../protocol';
import { IconClose, IconEdit, IconList, IconRewind } from '../icons';
import { STRINGS } from '../strings';

// The mark of the status of a file, the reader sees it at a glance.
function badge(status: UiChangedFile['status']): string {
  if (status === 'added') {
    return 'A';
  }
  if (status === 'deleted') {
    return 'D';
  }
  if (status === 'renamed') {
    return 'R';
  }
  return 'M';
}

function label(status: UiChangedFile['status']): string {
  if (status === 'added') {
    return STRINGS.summaryAdded;
  }
  if (status === 'deleted') {
    return STRINGS.summaryDeleted;
  }
  if (status === 'renamed') {
    return STRINGS.summaryRenamed;
  }
  return STRINGS.summaryModified;
}

// The files of the working tree that the last action changed. A click on a
// file opens it in the editor.
export function SummaryBar({
  files,
  onOpenFile,
  onDiff,
  onRevert,
  onClear
}: {
  files: UiChangedFile[];
  onOpenFile: (path: string) => void;
  onDiff?: (path: string) => void;
  onRevert?: (path: string) => void;
  onClear?: () => void;
}) {
  if (files.length === 0) {
    return null;
  }
  return (
    <div className="summary-bar">
      <div className="summary-head">
        <span className="summary-icon">
          <IconList />
        </span>
        <span className="summary-title">{STRINGS.summaryTitle}</span>
        <span className="summary-count">{files.length}</span>
        {onClear ? (
          <button
            className="summary-clear"
            title={STRINGS.summaryClear}
            aria-label={STRINGS.summaryClear}
            onClick={onClear}
          >
            <IconClose />
          </button>
        ) : null}
      </div>
      <ul className="summary-files">
        {files.map((file) => (
          <li key={file.path} className="summary-row">
            <button
              className="summary-file"
              onClick={() => onOpenFile(file.path)}
              title={file.path}
            >
              <span
                className={'summary-badge summary-badge-' + file.status}
                title={label(file.status)}
              >
                {badge(file.status)}
              </span>
              <span className="summary-name">{file.path}</span>
            </button>
            {/* The work of the agent on one file: its change and the way
                back, the rest of the turn stays. */}
            {file.revertible && onDiff ? (
              <button className="summary-action" title={STRINGS.summaryDiff} aria-label={STRINGS.summaryDiff} onClick={() => onDiff(file.path)}>
                <IconEdit />
              </button>
            ) : null}
            {file.revertible && onRevert ? (
              <button className="summary-action" title={STRINGS.summaryRevert} aria-label={STRINGS.summaryRevert} onClick={() => onRevert(file.path)}>
                <IconRewind />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
