import type { UiQuota } from '../../quotaMeter';
import { meterLevel, quotaTitle } from '../../quotaMeter';

// The limits of the M Plan in the header: two thin bars, the 5-hour window
// and the week, each with the share left. The bar empties as the limit is
// spent, its color turns to the warning at a quarter and to the failure at
// a tenth. The numbers stay in the words of the bar, the tooltip names the
// reset of the window.
export function QuotaMeter({ quota }: { quota: UiQuota | undefined }) {
  if (!quota || (quota.fiveHour === undefined && quota.weekly === undefined)) {
    return null;
  }
  const title = quotaTitle(quota);
  return (
    <span className="quota" title={title} aria-label={title}>
      {quota.fiveHour !== undefined ? <Meter label="5h" percent={quota.fiveHour} /> : null}
      {quota.weekly !== undefined ? <Meter label="7d" percent={quota.weekly} /> : null}
    </span>
  );
}

function Meter({ label, percent }: { label: string; percent: number }) {
  return (
    <span className={'quota-meter quota-' + meterLevel(percent)}>
      <span className="quota-label">{label}</span>
      <span className="quota-track">
        <span className="quota-fill" style={{ width: Math.round(percent) + '%' }} />
      </span>
      <span className="quota-value">{Math.round(percent)}%</span>
    </span>
  );
}
