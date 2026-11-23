import { isAbsolute, relative, resolve } from 'node:path';

// The path of the model must stay inside the workspace root. Every tool that
// takes a path goes through this check: the join of the paths normalizes the
// .. and the model would walk out of the workspace.
export function resolveWorkspacePath(root: string, candidate: string): string {
  const target = isAbsolute(candidate) ? candidate : resolve(root, candidate);
  const rel = relative(resolve(root), target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes the workspace root: ' + candidate);
  }
  return target;
}
