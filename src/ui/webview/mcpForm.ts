// The form of a new MCP server in the tab of the settings: a name and one
// line, either the url of a server over HTTP or the command with its
// arguments. Quotes keep an argument with spaces whole.

export type ServerForm =
  | { ok: true; server: { name: string; command?: string; args?: string[]; url?: string } }
  | { ok: false; error?: string };

export function splitCommand(line: string): string[] {
  const parts: string[] = [];
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    parts.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return parts;
}

export function parseServerForm(name: string, target: string): ServerForm {
  const cleanName = name.trim();
  const line = target.trim();
  if (cleanName.length === 0 || line.length === 0) {
    return { ok: false };
  }
  if (!/^[\w.-]+$/.test(cleanName)) {
    return { ok: false, error: 'The name takes letters, digits, dots, dashes and underscores.' };
  }
  if (/^https?:\/\//i.test(line)) {
    return { ok: true, server: { name: cleanName, url: line } };
  }
  const [command, ...args] = splitCommand(line);
  if (!command) {
    return { ok: false };
  }
  return { ok: true, server: { name: cleanName, command, args } };
}
