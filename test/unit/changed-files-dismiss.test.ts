import { describe, expect, it } from 'vitest';
import { dismissKeys, withoutDismissed } from '../../src/host/changedFiles';

describe('the closed list of the changed files', () => {
  const before = [
    { path: 'src/a.ts', status: 'modified' as const },
    { path: './b.ts', status: 'added' as const }
  ];

  it('hides the files the reader already closed', () => {
    const dismissed = dismissKeys(before);
    const repo = [...before, { path: 'c.ts', status: 'modified' as const }];
    expect(withoutDismissed(repo, dismissed)).toEqual([{ path: 'c.ts', status: 'modified' }]);
  });

  it('shows a closed file again when its status changes', () => {
    const dismissed = dismissKeys(before);
    expect(withoutDismissed([{ path: 'src/a.ts', status: 'deleted' }], dismissed)).toEqual([
      { path: 'src/a.ts', status: 'deleted' }
    ]);
  });
});
