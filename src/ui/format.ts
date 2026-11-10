// The panel and the status bar show big numbers, a short form with a
// suffix keeps them readable: 757247 tokens become 757K.

const UNITS = [
  { limit: 1_000_000_000, suffix: 'B' },
  { limit: 1_000_000, suffix: 'M' },
  { limit: 1_000, suffix: 'K' }
];

// The time of an action is read by a person: milliseconds are too short
// to see, minutes are too long. The value grows from ms to s to m.
export function formatDuration(milliseconds: number): string {
  const ms = Math.max(0, Math.round(milliseconds));
  if (ms < 1000) {
    return ms + 'ms';
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return (Math.round(seconds * 10) / 10).toFixed(1).replace(/\.0$/, '') + 's';
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  if (rest === 60) {
    return minutes + 1 + 'm 0s';
  }
  return minutes + 'm ' + rest + 's';
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const sign = value < 0 ? '-' : '';
  const amount = Math.abs(value);
  for (const unit of UNITS) {
    if (amount < unit.limit) {
      continue;
    }
    const scaled = amount / unit.limit;
    // One decimal under ten, a whole number above: 1.2M but 757K.
    const text =
      scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : String(Math.round(scaled));
    return sign + text + unit.suffix;
  }
  return sign + String(Math.round(amount));
}
