import { sep as pathSep } from 'node:path';
import type { UiSkill } from '../ui/extrasProtocol';

// Where a skill lives: a plugin package, the project, or the folders of the
// user. The tab Skills groups by it.
export function skillSource(dir: string, root: string, sep: string = pathSep): UiSkill['source'] {
  const path = dir.toLowerCase();
  if (path.includes(sep + '.minimax' + sep + 'plugins' + sep)) {
    return 'plugin';
  }
  if (root && path.startsWith(root.toLowerCase() + sep)) {
    return 'project';
  }
  return 'user';
}
