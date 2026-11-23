import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createAllTools } from '../../src/tools/all';
import { describerNames } from '../../src/ui/webview/components/toolDescriptions';

describe('the describers of the cards', () => {
  it('knows every tool of the extension', () => {
    // The list of the tools comes from the host itself, a copy of it in the
    // test would drift from the extension and would miss a new tool.
    const tools = createAllTools({
      backups: new InMemoryBackupStore(),
      search: () => undefined,
      spawn: async () => ({ content: 'the child did not run in the test' })
    });
    const known = new Set(describerNames());
    // A tool without a row falls to the generic card: the title of the card
    // is the raw name of the tool, the reader sees nothing of the action.
    const missing = tools.map((tool) => tool.name).filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });
});
