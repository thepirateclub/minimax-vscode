import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createCmdTools } from '../../src/tools/cmd';
import { createContainerTools } from '../../src/tools/containers';
import { createExploreTools } from '../../src/tools/explore';
import { createFileTools } from '../../src/tools/fs';
import { createGitTools } from '../../src/tools/git';
import { createGoalTools } from '../../src/tools/goal';
import { createReplTools } from '../../src/tools/repl';
import { createTaskTools } from '../../src/tools/task';
import { createTaskFileTools } from '../../src/tools/tasks';
import { createTerminalTools } from '../../src/tools/terminal';
import { createTodoTools } from '../../src/tools/todo';
import { describerNames } from '../../src/ui/webview/components/toolDescriptions';

describe('the describers of the cards', () => {
  it('knows every tool of the extension', () => {
    const tools = [
      ...createFileTools({ backups: new InMemoryBackupStore() }),
      ...createExploreTools(),
      ...createGitTools(),
      ...createTerminalTools(),
      ...createCmdTools(),
      ...createTodoTools(),
      ...createTaskFileTools(),
      ...createReplTools(),
      ...createContainerTools(),
      ...createGoalTools(),
      ...createTaskTools({
        spawn: async () => ({ content: 'the child did not run in the test' })
      })
    ];
    const known = new Set(describerNames());
    // A tool without a row falls to the generic card: the title of the card
    // is the raw name of the tool, the reader sees nothing of the action.
    const missing = tools.map((tool) => tool.name).filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });
});
