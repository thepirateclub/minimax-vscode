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
  ['src/ui/webview/highlight.ts', ['src/ui/webview/highlight.ts', 'src/ui/webview/highlight/tokens.ts', 'src/ui/webview/highlight/languages.ts', 'src/ui/webview/highlight/helpers.ts', 'src/ui/webview/highlight/lexer.ts', 'src/ui/webview/highlight/tokenizers.ts', 'src/ui/webview/highlight/tokenizersText.ts']],
  ['src/ui/webview/components/ToolCard.tsx', ['src/ui/webview/components/ToolCard.tsx', 'src/ui/webview/components/toolDescriptions.tsx', 'src/ui/webview/components/toolCardHelpers.ts']],
  ['src/ui/webview/components/Composer.tsx', ['src/ui/webview/components/Composer.tsx', 'src/ui/webview/components/ComposerInput.tsx', 'src/ui/webview/components/composerField.ts']],
  ['src/ui/webview/App.tsx', ['src/ui/webview/App.tsx', 'src/ui/webview/usePanelMessages.ts']]
];

const normalise = (line) =>
  line
    .replace(/\s+/g, ' ')
    .replace(/^export /, '')
    .replace(/^private /, '')
    .replace(/^async /, '')
    .trim();

for (const [oldPath, newPaths] of pairs) {
  let old;
  try {
    old = execFileSync('git', ['show', BASE + ':' + oldPath], { encoding: 'utf8' });
  } catch {
    console.log(oldPath + ': no version in base');
    continue;
  }
  const oldLines = old.split(/\r?\n/).map(normalise).filter((l) => l.length > 0);
  const bag = [];
  for (const p of newPaths) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      bag.push(normalise(line));
    }
  }
  const count = new Map();
  for (const line of bag) {
    count.set(line, (count.get(line) ?? 0) + 1);
  }
  const lost = [];
  for (const line of oldLines) {
    const have = count.get(line) ?? 0;
    if (have > 0) {
      count.set(line, have - 1);
    } else {
      lost.push(line);
    }
  }
  console.log('=== ' + oldPath + ' (' + oldLines.length + ' lines, lost ' + lost.length + ')');
  for (const line of lost.slice(0, 30)) {
    console.log('  - ' + line);
  }
}
