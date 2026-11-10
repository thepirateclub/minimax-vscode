import type { UiMessage } from '../../protocol';
import { STRINGS } from '../strings';
import { DiffView } from './DiffView';
import { approvalTitle, formatInput } from '../toolText';

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
  return (
    <div className="approval">
      <div className="approval-title">{approvalTitle(approval.name, approval.input)}</div>
      {approval.preview ? (
        <DiffView path={approval.preview.path} lines={approval.preview.lines} />
      ) : approval.name === 'run_terminal' ? (
        // The command reads like the line of a terminal, not like a json dump.
        <pre className="tool-input approval-command">
          <span className="term-prompt">$ </span>
          {String(approval.input['command'] ?? '')}
        </pre>
      ) : (
        <pre className="tool-input">{formatInput(approval.input)}</pre>
      )}
      <div className="approval-actions">
        <button onClick={() => onApprove(false)}>{STRINGS.approve}</button>
        {/* One primary button in a group, the wider grant is secondary. */}
        <button className="secondary" onClick={() => onApprove(true)}>
          {STRINGS.alwaysAllow}
        </button>
        <button className="secondary" onClick={onReject}>
          {STRINGS.reject}
        </button>
      </div>
    </div>
  );
}
