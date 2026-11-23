import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE = '72be5ef';
const pairs = [
  ['src/tools/tasks.ts', ['src/tools/tasks.ts', 'src/tools/tasks/types.ts', 'src/tools/tasks/parse.ts', 'src/tools/tasks/edit.ts', 'src/tools/tasks/file.ts']],
  ['src/tools/repl.ts', ['src/tools/repl.ts', 'src/tools/repl/protocol.ts', 'src/tools/repl/processes.ts']],
  ['src/search/project.ts', ['src/search/project.ts', 'src/search/project/protocol.ts', 'src/search/project/lines.ts', 'src/search/project/class.ts']],
  ['src/ui/webview/icons.tsx', ['src/ui/webview/icons.tsx', 'src/ui/webview/icons/base.tsx', 'src/ui/webview/icons/modes.tsx', 'src/ui/webview/icons/tools.tsx', 'src/ui/webview/icons/actions.tsx']],
  ['src/agent/agent.ts', ['src/agent/agent.ts', 'src/agent/types.ts', 'src/agent/retry.ts', 'src/agent/toolRunner.ts']],
  ['src/storage/sessions.ts', ['src/storage/sessions.ts', 'src/storage/caps.ts']],
  ['src/tools/git.ts', ['src/tools/git.ts', 'src/tools/git/common.ts', 'src/tools/git/read.ts', 'src/tools/git/write.ts', 'src/tools/git/worktrees.ts']],
  ['src/tools/containers.ts', ['src/tools/containers.ts', 'src/tools/containers/args.ts', 'src/tools/containers/runtime.ts']],
  ['src/ui/webview/components/ToolCard.tsx', ['src/ui/webview/components/ToolCard.tsx', 'src/ui/webview/components/toolDescriptions.tsx', 'src/ui/webview/components/toolCardHelpers.ts']],
  ['src/ui/webview/components/Composer.tsx', ['src/ui/webview/components/Composer.tsx', 'src/ui/webview/components/ComposerInput.tsx', 'src/ui/webview/components/composerField.ts']],
  ['src/ui/webview/App.tsx', ['src/ui/webview/App.tsx', 'src/ui/webview/usePanelMessages.ts']]
];

const exportedNames = (text) => {
  const names = new Set();
  const re = /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    names.add(m[1]);
  }
  const star = /^export\s+\*\s+from\s+'([^']+)'/gm;
  while ((m = star.exec(text)) !== null) {
    names.add('*' + m[1]);
  }
  const list = /^export\s*\{([^}]*)\}/gm;
  while ((m = list.exec(text)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '');
      if (name.length > 0) {
        names.add(name.split(/\s+as\s+/).pop());
      }
    }
  }
  return names;
};

for (const [oldPath, newPaths] of pairs) {
  let old;
  try {
    old = execFileSync('git', ['show', BASE + ':' + oldPath], { encoding: 'utf8' });
  } catch {
    continue;
  }
  const oldNames = exportedNames(old);
  const newNames = new Set();
  const stars = [];
  for (const p of newPaths) {
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const n of exportedNames(text)) {
      if (n.startsWith('*')) {
        stars.push(n.slice(1));
      } else {
        newNames.add(n);
      }
    }
  }
  const lost = [...oldNames].filter(
    (n) => !n.startsWith('*') && !newNames.has(n) && !stars.some((s) => s.endsWith(oldPath.replace(/^src\//, './')) || s.includes(oldPath.split('/').pop().replace(/\.tsx?$/, '')))
  );
  console.log('=== ' + oldPath + ': exported ' + oldNames.size + ', lost ' + lost.length + (lost.length ? ': ' + lost.join(', ') : ''));
}
