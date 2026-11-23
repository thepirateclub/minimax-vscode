// The value of an argument of a tool is shown as a text: a string is itself,
// an object is a short json.
export function text(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

// The value of a file is a string, everything else is nothing.
export function textOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
