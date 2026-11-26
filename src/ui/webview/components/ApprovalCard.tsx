import { useEffect, useRef } from 'react';
import type { UiMessage } from '../../protocol';
import { approvalKey, focusOf } from '../approvalKeys';
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
  const ref = useRef<HTMLDivElement>(null);
  const strict = approval ? alwaysConfirms(approval.name, approval.input) : true;
  useEffect(() => {
    if (!approval) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      const cards = document.querySelectorAll('.approval');
      // Only the newest card answers the keys: two cards would both allow.
      if (event.defaultPrevented || cards[cards.length - 1] !== ref.current) {
        return;
      }
      const action = approvalKey(event, focusOf(document.activeElement, ref.current), {
        strict,
        canAlways: !strict
      });
      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (action === 'reject') {
        onReject();
      } else {
        onApprove(action === 'always');
      }
    };
    // The capture phase: the field of the composer must not send the empty
    // text or leave the goal mode on the same key.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [approval, strict, onApprove, onReject]);
  if (!approval) {
    return null;
  }
  const files = approval.files ?? [];
  // The size of a file is known when the disk answered, the total is only
  // true when every size is known.
  const sizesKnown = files.length > 0 && files.every((file) => file.bytes !== undefined);
  const total = files.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
  return (
    <div className="approval" ref={ref} tabIndex={-1}>
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
        <button title={STRINGS.approveKey} aria-keyshortcuts="Enter" onClick={() => onApprove(false)}>
          {STRINGS.approve}
        </button>
        {/* One primary button in a group, the wider grant is secondary. The
            button names its scope: the prefix of the command or the folder.
            A tool that always asks has no grant, the card shows none. */}
        {!alwaysConfirms(approval.name, approval.input) ? (
          <button className="secondary" title={STRINGS.alwaysKey} aria-keyshortcuts="A" onClick={() => onApprove(true)}>
            {scopeLabel(approval.name, approval.input)}
          </button>
        ) : null}
        <button className="secondary" title={STRINGS.rejectKey} aria-keyshortcuts="Escape" onClick={onReject}>
          {STRINGS.reject}
        </button>
      </div>
    </div>
  );
}
