import type { UiMessage } from '../../protocol';
import { STRINGS } from '../strings';
import { DiffView } from './DiffView';
import { approvalTitle, formatInput } from '../toolCard';
import { alwaysConfirms, scopeLabel } from '../../approvalScope';
import { formatBytes } from '../../format';

export function ApprovalCard({
  message,
  onApprove,
  onReject
}: {
  message: UiMessage;
  onApprove: (allowForSession: boolean) => void;
  onReject: () => void;
}) {
  const approval = message.approval;
  if (!approval) {
    return null;
  }
  const files = approval.files ?? [];
  // The size of a file is known when the disk answered, the total is only
  // true when every size is known.
  const sizesKnown = files.length > 0 && files.every((file) => file.bytes !== undefined);
  const total = files.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
  return (
    <div className="approval">
      <div className="approval-title">{approvalTitle(approval.name, approval.input)}</div>
      {files.length > 0 ? (
        // The card of a deletion names every file with its size: the reader
        // sees what goes away before he answers.
        <div className="approval-files">
          <div className="approval-files-head">
            {files.length}{' '}
            {files.length === 1 ? STRINGS.toolFile : STRINGS.toolFiles}
            {sizesKnown ? ', ' + formatBytes(total) : ''}
          </div>
          <ul className="approval-file-list">
            {files.map((file) => (
              <li key={file.path} className="approval-file">
                <span className="approval-file-path">{file.path}</span>
                {file.bytes !== undefined ? (
                  <span className="approval-file-size">{formatBytes(file.bytes)}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="approval-warning">{STRINGS.approvalDeleteWarning}</div>
        </div>
      ) : approval.preview ? (
        <DiffView path={approval.preview.path} lines={approval.preview.lines} />
      ) : approval.name === 'run_terminal' ? (
        // The command reads like the line of a terminal, not like a json dump.
        <pre className="tool-input approval-command">
          <span className="term-prompt">$ </span>
          {String(approval.input['command'] ?? '')}
        </pre>
      ) : formatInput(approval.input).length > 0 ? (
        <pre className="tool-input">{formatInput(approval.input)}</pre>
      ) : null}
      <div className="approval-actions">
        <button onClick={() => onApprove(false)}>{STRINGS.approve}</button>
        {/* One primary button in a group, the wider grant is secondary. The
            button names its scope: the prefix of the command or the folder.
            A tool that always asks has no grant, the card shows none. */}
        {!alwaysConfirms(approval.name) ? (
          <button className="secondary" onClick={() => onApprove(true)}>
            {scopeLabel(approval.name, approval.input)}
          </button>
        ) : null}
        <button className="secondary" onClick={onReject}>
          {STRINGS.reject}
        </button>
      </div>
    </div>
  );
}
