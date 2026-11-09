import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ManifestCommand {
  command: string;
  title: string;
}

interface ManifestMenuEntry {
  command: string;
  when?: string;
  group?: string;
  viewId?: string;
}

interface Manifest {
  contributes: {
    commands: ManifestCommand[];
    menus: Record<string, ManifestMenuEntry[]>;
  };
}

// The manifest is the contract with the editor, the tests of the panels
// do not see it.
const manifest = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8')
) as Manifest;

describe('the manifest of the extension', () => {
  it('offers the numbers of the plan in the command palette', () => {
    const command = manifest.contributes.commands.find(
      (item) => item.command === 'minimax.showUsage'
    );
    expect(command).toBeDefined();
    expect(command?.title.length).toBeGreaterThan(0);
  });

  it('puts the commit message button into the title of the source control', () => {
    // The title of the source control takes the items of the scm/title menu.
    const entry = (manifest.contributes.menus['scm/title'] ?? []).find(
      (item) => item.command === 'minimax.generateCommitMessage'
    );
    expect(entry).toBeDefined();
    // The group has to be exact, navigation@1 lands in the overflow menu.
    expect(entry?.group).toBe('navigation');
    // The key scmProvider is not set in every window, a hidden button looks
    // like a broken feature.
    expect(entry?.when).toBeUndefined();
  });
});
