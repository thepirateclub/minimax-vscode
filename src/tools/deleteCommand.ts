// The commands of the deletion do not run in the shell: the tool of the
// deletion asks the user and shows the list of the files before they go
// away. A rule of the reader cannot cover it, so the shell is not a way
// around the card of the confirmation.

// The names of the commands that delete: rm and rmdir of the shell of
// POSIX, del, erase and rd of the command line of Windows, Remove-Item of
// the shell of PowerShell.
const DELETE_COMMANDS = new Set([
  'rm',
  'rmdir',
  'del',
  'erase',
  'unlink',
  'rd',
  'remove-item'
]);

// The shells run a command of their own behind a flag.
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'pwsh', 'powershell', 'cmd']);

// The segments of a command: the shell runs them one after another.
const SEGMENTS = /&&|\|\||;|\||\r?\n/;

// The name of the command: without the path, without the extension and
// without the case.
function nameOf(word: string | undefined): string {
  if (word === undefined) {
    return '';
  }
  const plain = word.replace(/^["']|["']$/g, '');
  const base = plain.split(/[\\/]/).pop() ?? plain;
  return base.toLowerCase().replace(/\.exe$/, '');
}

// The tool that has to serve the command, if the command deletes something.
export function deleteToolFor(command: string): string | undefined {
  for (const segment of command.split(SEGMENTS)) {
    const words = segment
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0);
    const found = findDelete(words);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findDelete(words: string[]): string | undefined {
  const first = nameOf(words[0]);
  if (first.length === 0) {
    return undefined;
  }
  if (SHELLS.has(first)) {
    const flag = (words[1] ?? '').toLowerCase();
    if (flag !== '-c' && flag !== '-command' && flag !== '/c') {
      return undefined;
    }
    // The shell runs the rest of the line as a command of its own.
    const inner = words
      .slice(2)
      .join(' ')
      .replace(/^["']|["']$/g, '');
    return deleteToolFor(inner);
  }
  if (DELETE_COMMANDS.has(first)) {
    return 'delete_files';
  }
  // git rm takes the file out of the working tree and out of the index.
  if (first === 'git' && nameOf(words[1]) === 'rm') {
    return 'delete_files';
  }
  return undefined;
}
