// The panel and the status bar show big numbers, a short form with a
// suffix keeps them readable: 757247 tokens become 757K.

const UNITS = [
  { limit: 1_000_000_000, suffix: 'B' },
  { limit: 1_000_000, suffix: 'M' },
  { limit: 1_000, suffix: 'K' }
];

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
