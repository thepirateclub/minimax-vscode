// The lines of list_files with the details of the files. The model asked the
// shell for them: `Get-ChildItem a, b -ErrorAction SilentlyContinue |
// Select-Object FullName, Length, LastWriteTime`, a command of one shell
// with the colors of the terminal in the answer. The tool reads the same
// with Node, on every system and without a program of the shell.

export interface ListedEntry {
  // The path relative to the workspace root, with slashes, a folder ends with /.
  path: string;
  folder: boolean;
  size: number;
  modified: Date;
}

export type ListSort = 'name' | 'size' | 'time';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return bytes + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// The local time of the machine: the model compares it with the time of a
// run it has just made.
export function formatTime(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' +
    pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  );
}

export function sortEntries(entries: ListedEntry[], sort: ListSort | undefined): ListedEntry[] {
  if (sort === 'size') {
    return [...entries].sort((a, b) => b.size - a.size);
  }
  if (sort === 'time') {
    return [...entries].sort((a, b) => b.modified.getTime() - a.modified.getTime());
  }
  return entries;
}

// One line per entry: the path, the size and the time of the last change.
// A folder has no size of its own.
export function formatEntries(entries: ListedEntry[], details: boolean): string[] {
  if (!details) {
    return entries.map((entry) => entry.path);
  }
  const width = Math.min(80, Math.max(...entries.map((entry) => entry.path.length), 0));
  return entries.map(
    (entry) =>
      entry.path.padEnd(width) + '  ' + (entry.folder ? 'folder'.padStart(9) : formatBytes(entry.size).padStart(9)) +
      '  ' + formatTime(entry.modified)
  );
}
