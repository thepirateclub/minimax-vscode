import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// The path of the model must stay inside the workspace root. Every tool that
// takes a path goes through this check: the join of the paths normalizes the
// .. and the model would walk out of the workspace.
export function resolveWorkspacePath(root: string, candidate: string): string {
  const base = resolve(root);
  const target = isAbsolute(candidate) ? resolve(candidate) : resolve(base, candidate);
  if (escapes(base, target)) {
    throw new Error('path escapes the workspace root: ' + candidate);
  }
  // The lexical check does not see links: a symlink or a junction of the
  // repository (creds -> ~/.aws/credentials) would let read_file and
  // write_file reach a file outside. The real path of the nearest existing
  // part of the target must stay inside the real root.
  const realBase = realOrSelf(base);
  if (escapes(realBase, realExisting(target))) {
    throw new Error('path escapes the workspace root through a link: ' + candidate);
  }
  return target;
}

function escapes(base: string, target: string): boolean {
  const rel = relative(base, target);
  // '..foo' is a file name inside the root, only '..' as a whole part leaves.
  return rel === '..' || rel.startsWith('..' + sep) || rel.startsWith('../') || isAbsolute(rel);
}

function realOrSelf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

// The real path of the deepest existing ancestor with the missing tail
// appended: a new file is checked through the folder it lands in.
function realExisting(target: string): string {
  const tail: string[] = [];
  let current = target;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...tail.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return target;
      }
      tail.push(basename(current));
      current = parent;
    }
  }
}
