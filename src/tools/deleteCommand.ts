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
  'ri',
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

// The words that run the command after them: `env rm`, `sudo rm`, `VAR=1 rm`
// still delete. Their own flags stand before the command.
const WRAPPERS = new Set(['env', 'command', 'sudo', 'doas', 'exec', 'nohup', 'time', 'nice', 'xargs', 'builtin', 'busybox']);

function unwrap(words: string[]): string[] {
  let index = 0;
  while (index < words.length) {
    const word = words[index]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      index += 1;
    } else if (WRAPPERS.has(nameOf(word))) {
      index += 1;
      while ((words[index] ?? '').startsWith('-')) {
        index += 1;
      }
    } else {
      break;
    }
  }
  return words.slice(index);
}

// The global flags of git that take a value: `git -C sub rm` is git rm.
const GIT_VALUE_FLAGS = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);

function gitSubcommand(words: string[]): string {
  let index = 1;
  while ((words[index] ?? '').startsWith('-')) {
    const flag = words[index]!;
    index += flag === '-C' || GIT_VALUE_FLAGS.has(flag) ? 2 : 1;
  }
  return nameOf(words[index]);
}

function findDelete(all: string[]): string | undefined {
  const words = unwrap(all);
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
  if (first === 'git' && gitSubcommand(words) === 'rm') {
    return 'delete_files';
  }
  return undefined;
}
