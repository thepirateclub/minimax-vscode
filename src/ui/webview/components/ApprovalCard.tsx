import type { UiMessage } from '../../protocol';
import { STRINGS } from '../strings';
import { DiffView } from './DiffView';

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
      <div className="approval-title">Run {approval.name}?</div>
      {approval.preview ? (
        <DiffView path={approval.preview.path} lines={approval.preview.lines} />
      ) : (
        <pre className="tool-input">{JSON.stringify(approval.input, null, 2)}</pre>
      )}
      <div className="approval-actions">
        <button onClick={() => onApprove(false)}>{STRINGS.approve}</button>
        <button onClick={() => onApprove(true)}>{STRINGS.alwaysAllow}</button>
        <button className="secondary" onClick={onReject}>
          {STRINGS.reject}
        </button>
      </div>
    </div>
  );
}
