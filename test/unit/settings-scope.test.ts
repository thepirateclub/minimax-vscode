import { describe, expect, it, vi } from 'vitest';

// The editor merges the settings: a value of the workspace wins over the
// value of the user in get(). The mock does the same.
const user = new Map<string, unknown>();
const workspace = new Map<string, unknown>();
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) => (workspace.has(key) ? workspace.get(key) : user.has(key) ? user.get(key) : fallback),
      inspect: (key: string) => ({ key, defaultValue: undefined, globalValue: user.get(key), workspaceValue: workspace.get(key) })
    })
  }
}));

const { getSettings } = await import('../../src/config/settings');

// A cloned repository turned the sending of the code on through its
// .vscode/settings.json: these settings are read from the user only.
describe('the settings that send data to the server', () => {
  it('ignore the value of the workspace', () => {
    workspace.set('semanticSearch', true);
    workspace.set('enableWebSearch', true);
    expect(getSettings().semanticSearch).toBe(false);
    expect(getSettings().enableWebSearch).toBe(false);
  });

  it('take the value of the user', () => {
    user.set('semanticSearch', true);
    user.set('enableWebSearch', true);
    expect(getSettings().semanticSearch).toBe(true);
    expect(getSettings().enableWebSearch).toBe(true);
  });
});
