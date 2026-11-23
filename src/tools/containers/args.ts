import { CONTAINER_MAX_OUTPUT_CHARS, type ContainerRunOptions } from '../containers';

// The arguments of the commands of the runtime and the checks of the names.
export function isValidContainerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

export function isValidContainerImage(image: string): boolean {
  return image.length > 0 && !image.startsWith('-');
}

// A command line is split by the spaces that stand outside the quotes. A
// plain split by spaces broke a path with a space and a quoted phrase into
// pieces, the container received other arguments than the model meant.
export function splitCommandLine(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  for (const ch of text) {
    if (quote.length > 0) {
      if (ch === quote) {
        quote = '';
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

// The command comes as an array; a single string is accepted too, the model
// sends it sometimes. The string goes through the quote-aware split.
export function parseCommandArg(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? splitCommandLine(trimmed) : [];
  }
  return [];
}

export function buildListArgs(): string[] {
  return ['ps', '--all', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}'];
}

export function buildImagesArgs(): string[] {
  return ['images', '--format', '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'];
}

export function buildLogsArgs(name: string, tail: number): string[] {
  return ['logs', '--tail', String(tail), name];
}

export function buildRunArgs(options: ContainerRunOptions): string[] {
  const args = ['run'];
  if (options.name !== undefined && options.name.length > 0) {
    args.push('--name', options.name);
  }
  if (options.detach !== false) {
    args.push('--detach');
  }
  args.push(options.image);
  if (options.command !== undefined && options.command.length > 0) {
    args.push(...options.command);
  }
  return args;
}

export function buildStopArgs(name: string): string[] {
  return ['stop', name];
}

export function buildExecArgs(name: string, command: string[]): string[] {
  return ['exec', name, ...command];
}

export function truncateContainerOutput(
  text: string,
  limit: number = CONTAINER_MAX_OUTPUT_CHARS
): string {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit) + '\n[output truncated: ' + (text.length - limit) + ' characters cut]';
}
