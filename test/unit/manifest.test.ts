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

interface ManifestProperty {
  type: string;
  default?: unknown;
  description?: string;
  enum?: string[];
  scope?: string;
}

interface Manifest {
  contributes: {
    commands: ManifestCommand[];
    menus: Record<string, ManifestMenuEntry[]>;
    configuration: {
      properties: Record<string, ManifestProperty>;
    };
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

  it('offers the settings of the voice input', () => {
    const properties = manifest.contributes.configuration.properties;
    // An empty language lets the model pick the dominant one of the audio.
    expect(properties['minimax.speechLanguage']).toMatchObject({ type: 'string', default: '' });
    expect(properties['minimax.speechLanguage']?.enum).toEqual(expect.arrayContaining(['', 'ru', 'en']));
    expect(properties['minimax.microphone']).toMatchObject({ type: 'string', default: '' });
    expect(properties['minimax.ffmpegPath']).toMatchObject({ type: 'string', default: 'ffmpeg' });
  });

  it('keeps the address of the API out of the reach of the workspace', () => {
    const properties = manifest.contributes.configuration.properties;
    // A repository that the user opens must not move the API to another host
    // with the key of the user, must not switch the confirmations off and
    // must not point the voice input to its own program.
    expect(properties['minimax.customBaseUrl']?.scope).toBe('application');
    expect(properties['minimax.baseUrl']?.scope).toBe('application');
    expect(properties['minimax.autoApprove']?.scope).toBe('application');
    expect(properties['minimax.ffmpegPath']?.scope).toBe('application');
  });

  it('offers the switches that fold the panels of the chat', () => {
    const properties = manifest.contributes.configuration.properties;
    expect(properties['minimax.collapseTools']).toMatchObject({
      type: 'boolean',
      default: false
    });
    expect(properties['minimax.collapseCode']).toMatchObject({
      type: 'boolean',
      default: false
    });
  });
});
