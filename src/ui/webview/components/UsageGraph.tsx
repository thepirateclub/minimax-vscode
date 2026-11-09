import type { UiUsageTurn } from '../../protocol';
import { formatCount } from '../format';
import { STRINGS } from '../strings';

// One bar per action, the height is the token spend of that action.
export function UsageGraph({ turns }: { turns: UiUsageTurn[] }) {
  if (turns.length === 0) {
    return null;
  }
  const max = Math.max(
    ...turns.map((turn) => turn.input + (turn.cache ?? 0) + turn.output),
    1
  );
  return (
    <div className="usage-graph" role="img" aria-label={STRINGS.usageGraph}>
      {turns.map((turn, index) => (
        <span
          key={index}
          className="usage-column"
          title={
            STRINGS.usageAction +
            ' ' +
            (index + 1) +
            ': in ' +
            formatCount(turn.input + (turn.cache ?? 0)) +
            ((turn.cache ?? 0) > 0
              ? ' (' + formatCount(turn.cache ?? 0) + ' ' + STRINGS.usageCached + ')'
              : '') +
            ', out ' +
            formatCount(turn.output)
          }
        >
          <span
            className="usage-output"
            style={{ height: ((turn.output / max) * 100).toFixed(2) + '%' }}
          />
          <span
            className="usage-input"
            style={{
              height: (((turn.input + (turn.cache ?? 0)) / max) * 100).toFixed(2) + '%'
            }}
          />
        </span>
      ))}
    </div>
  );
}
