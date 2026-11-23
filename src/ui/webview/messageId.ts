// The ids of the rows of the panel. Two notices can arrive in one
// millisecond: one id for two rows would give React one key for two rows,
// and the list draws the wrong row. The counter tells them apart.
let counter = 0;

export function messageId(prefix: string): string {
  counter += 1;
  return prefix + '-' + Date.now().toString(36) + '-' + counter;
}
