// A link of an answer did nothing: the policy of the webview forbids the
// navigation and no handler took the click. The click goes to the host now:
// a web address opens in the browser through the editor (which asks about
// an unknown domain itself), a relative path opens the file of the project.

export type LinkTarget = { kind: 'web'; url: string } | { kind: 'file'; path: string; line?: number };

export function linkTarget(href: string): LinkTarget | undefined {
  const value = href.trim();
  if (/^https?:\/\//i.test(value)) {
    return { kind: 'web', url: value };
  }
  // Any other scheme (javascript:, data:, command:, file:) and an anchor
  // inside the page do nothing.
  if (value.length === 0 || value.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) {
    return undefined;
  }
  const match = /^(.*?)(?:#L?(\d+)(?:-L?\d+)?|:(\d+))?$/.exec(value);
  const raw = (match?.[1] ?? value).replace(/^\.\//, '');
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // A broken escape (`%zz`) is a literal name, not a crash of the click.
    path = raw;
  }
  const line = Number(match?.[2] ?? match?.[3] ?? 0);
  return path.length > 0 ? { kind: 'file', path, ...(line > 0 ? { line } : {}) } : undefined;
}
