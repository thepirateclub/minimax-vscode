import { describe, expect, it, vi } from 'vitest';

const folders = [
  { name: 'api', uri: { fsPath: '/work/api' } },
  { name: 'web', uri: { fsPath: '/work/web' } }
];
vi.mock('vscode', () => ({
  workspace: { get workspaceFolders() { return folders; } },
  window: {},
  commands: {}
}));

const { currentRoot } = await import('../../src/host/folders');

function contextWith(value: string | undefined) {
  return { workspaceState: { get: () => value } } as never;
}

describe('the project folder of a window with several folders', () => {
  it('is the folder the reader chose', () => {
    expect(currentRoot(contextWith('/work/web'))).toBe('/work/web');
  });

  it('falls back to the first folder when there is no choice or the folder left', () => {
    expect(currentRoot(contextWith(undefined))).toBe('/work/api');
    expect(currentRoot(contextWith('/work/gone'))).toBe('/work/api');
  });
});
