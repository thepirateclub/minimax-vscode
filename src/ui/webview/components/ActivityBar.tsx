import { useEffect, useState } from 'react';
import { formatDuration } from '../../format';
import type { ActiveAction } from '../activityStatus';

// The live status of the agent: what it does right now. The row stands above
// the field of the request and hides itself when the agent does nothing. It
// is a status and not a history: only the action that runs now is in it.
export function ActivityBar({
  action,
  startedAt
}: {
  action: ActiveAction | undefined;
  // When the action started, the clock of the row counts from it.
  startedAt: number | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!action || startedAt === undefined) {
      return;
    }
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [action, startedAt]);
  if (!action) {
    return null;
  }
  return (
    <div className="composer-activity" role="status" aria-live="polite">
      <span className="composer-activity-dot" />
      <span className="composer-activity-name">{action.name}</span>
      <span className="composer-activity-detail">{action.detail}</span>
      {action.target.length > 0 ? (
        <span className="composer-activity-target">{action.target}</span>
      ) : null}
      {startedAt !== undefined ? (
        <span className="composer-activity-time">{formatDuration(now - startedAt)}</span>
      ) : null}
    </div>
  );
}
