// The editor writes the failures of a file as a dump with URIs and a
// detail line, a person needs one sentence.
const MISSING = /nonexistent file|enoent|no such file or directory|file not found/i;
const PERMISSION = /permission denied|eacces|eperm|access is denied/i;
const LOCKED = /ebusy|resource busy or locked|being used by another process/i;
const OUTSIDE = /escapes the workspace root|outside the workspace/i;
const DIRECTORY = /eisdir|is a directory/i;

// The reason of a failure is cut to the first line, the rest is noise.
function shortReason(reason: string): string {
  const line = reason.split('\n')[0]?.trim() ?? '';
  if (line.length === 0) {
    return '';
  }
  return line.length > 120 ? line.slice(0, 120) + '…' : line;
}

export function fileErrorMessage(path: string, reason: string): string {
  if (OUTSIDE.test(reason)) {
    return 'Cannot open ' + path + ': the path is outside the workspace.';
  }
  if (LOCKED.test(reason)) {
    return 'Cannot open ' + path + ': the file is locked by another program.';
  }
  if (PERMISSION.test(reason)) {
    return 'Cannot open ' + path + ': the access is denied.';
  }
  if (MISSING.test(reason)) {
    return 'Cannot open ' + path + ': the file does not exist.';
  }
  if (DIRECTORY.test(reason)) {
    return 'Cannot open ' + path + ': the path is a directory.';
  }
  // A dump of the editor stays in the log, the panel gets a clean line.
  const clean =
    reason.includes('file://') || reason.includes('Detail:') ? '' : shortReason(reason);
  return clean.length > 0
    ? 'Cannot open ' + path + ': ' + clean
    : 'Cannot open ' + path + ': the editor cannot open this file.';
}
