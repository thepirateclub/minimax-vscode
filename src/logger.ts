export interface Logger {
  info(message: string): void;
  error(message: string, err?: unknown): void;
}

const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._-]+/g,
  /([?&](?:key|api_key|apikey|token)=)[^&\s]+/gi,
  // The key of the M Plan is long and holds dashes and underscores: sk-c...
  // The look behind keeps the words that only carry the letters inside, for
  // example task-priority, out of the mask.
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/g
];

export function redactSecrets(text: string): string {
  let out = text;
  out = out.replace(SECRET_PATTERNS[0]!, 'Bearer ***');
  out = out.replace(SECRET_PATTERNS[1]!, '$1***');
  out = out.replace(SECRET_PATTERNS[2]!, 'sk-***');
  return out;
}

export function createLogger(channel: { appendLine(value: string): void }): Logger {
  return {
    info(message: string): void {
      channel.appendLine(redactSecrets(message));
    },
    error(message: string, err?: unknown): void {
      channel.appendLine(redactSecrets('[error] ' + message));
      if (err !== undefined) {
        const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
        channel.appendLine(redactSecrets(text));
      }
    }
  };
}
