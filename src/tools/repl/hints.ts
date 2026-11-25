// A block of the REPL failed on a missing file: the model guessed the path
// (an absolute path of another machine, a path from another folder, a
// process.chdir of an earlier block that the process kept). The bare
// `ENOENT: no such file or directory, open` told it nothing, so the answer
// names where the relative paths start and how to find the file.
export function missingFileHint(error: string, workspaceRoot: string): string | undefined {
  const match = /ENOENT[^\n]*?(?:open|stat|scandir|lstat|access|readdir)\s*'?([^'\n]*)'?/.exec(error)
    ?? /No such file or directory:\s*'([^'\n]*)'/.exec(error);
  if (!match) {
    return undefined;
  }
  const path = (match[1] ?? '').trim();
  return (
    '[hint] ' + (path ? 'The file ' + path + ' does not exist. ' : 'The file does not exist. ') +
    'Relative paths start in the workspace root ' + workspaceRoot +
    ' unless an earlier block changed the directory. Find the path with list_files or search_code before you read it, ' +
    'and pass the path relative to the workspace root.'
  );
}
