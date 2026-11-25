import { describe, expect, it } from 'vitest';
import {
  fileKey,
  forgetChangedFiles,
  mergeChangedFiles,
  rememberChangedFiles
} from '../../src/host/changedFiles';

describe('the list of the changed files', () => {
  it('puts the files of the agent first and keeps the rest of the tree', () => {
    const merged = mergeChangedFiles(
      [{ path: 'new.ts', status: 'added' }],
      [
        { path: 'new.ts', status: 'added' },
        { path: 'app.ts', status: 'modified' }
      ]
    );
    expect(merged).toEqual([
      { path: 'new.ts', status: 'added' },
      { path: 'app.ts', status: 'modified' }
    ]);
  });

  it('keeps the status of the agent for a file of the tree', () => {
    // The agent knows that it created the file, the state of the repository
    // does not see it at all.
    const merged = mergeChangedFiles(
      [{ path: 'work/new.ts', status: 'added' }],
      [{ path: 'old.ts', status: 'deleted' }]
    );
    expect(merged).toEqual([
      { path: 'work/new.ts', status: 'added' },
      { path: 'old.ts', status: 'deleted' }
    ]);
  });

  it('counts a path with slashes as one file', () => {
    expect(fileKey('.\\work\\new.ts')).toBe('work/new.ts');
    expect(fileKey('./work/new.ts')).toBe('work/new.ts');
  });

  it('remembers the last status of a file', () => {
    const list = rememberChangedFiles(
      [{ path: 'a.ts', status: 'added' }],
      [{ path: 'a.ts', status: 'deleted' }]
    );
    expect(list).toEqual([{ path: 'a.ts', status: 'deleted' }]);
  });

  it('forgets the files that went back', () => {
    const list = forgetChangedFiles(
      [
        { path: 'a.ts', status: 'added' },
        { path: 'b.ts', status: 'modified' }
      ],
      ['a.ts']
    );
    expect(list).toEqual([{ path: 'b.ts', status: 'modified' }]);
  });
});
