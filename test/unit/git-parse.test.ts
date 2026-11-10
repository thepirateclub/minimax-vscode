import { describe, expect, it } from 'vitest';
import { parseBlame, parseBranches, parseLog, parseStatus } from '../../src/git/parse';

describe('the status of a repository', () => {
  it('reads the branch, the counters and the files', () => {
    const status = parseStatus(
      [
        '## main...origin/main [ahead 1, behind 2]',
        ' M src/app.ts',
        'A  src/new.ts',
        '?? notes.md'
      ].join('\n')
    );
    expect(status.branch).toBe('main');
    expect(status.upstream).toBe('origin/main');
    expect(status.ahead).toBe(1);
    expect(status.behind).toBe(2);
    expect(status.detached).toBe(false);
    expect(status.files).toHaveLength(3);
    expect(status.files[0]).toEqual({ path: 'src/app.ts', staged: ' ', unstaged: 'M' });
    // An untracked file is marked with a question mark in both columns.
    expect(status.files[2]).toEqual({ path: 'notes.md', staged: '?', unstaged: '?' });
  });

  it('knows a detached head and a branch without an upstream', () => {
    const detached = parseStatus('## HEAD (no branch)\n');
    expect(detached.detached).toBe(true);
    const plain = parseStatus('## feature\n');
    expect(plain.branch).toBe('feature');
    expect(plain.ahead).toBe(0);
    expect(plain.behind).toBe(0);
  });

  it('takes the new path of a rename and keeps the old one', () => {
    const status = parseStatus('R  old.ts -> new.ts\n');
    expect(status.files[0]?.path).toBe('new.ts');
    expect(status.files[0]?.oldPath).toBe('old.ts');
  });

  it('skips the ignored files', () => {
    const status = parseStatus('!! dist/\n');
    expect(status.files).toHaveLength(0);
  });
});

describe('the history', () => {
  it('reads the commits of a log', () => {
    const commits = parseLog(
      [
        'a1b2c3d\tGeorgy\t2026-11-10\tfeat: version in the panel',
        'd4e5f6a\tGeorgy\t2026-11-09\tfix: session id'
      ].join('\n')
    );
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: 'a1b2c3d',
      author: 'Georgy',
      date: '2026-11-10',
      subject: 'feat: version in the panel'
    });
  });
});

describe('the branches', () => {
  it('reads the list of the branches', () => {
    const branches = parseBranches(
      ['main\t*\torigin/main\t[ahead 1]', 'feature/x\t\t\t'].join('\n')
    );
    expect(branches).toHaveLength(2);
    expect(branches[0]?.name).toBe('main');
    expect(branches[0]?.current).toBe(true);
    expect(branches[0]?.upstream).toBe('origin/main');
    expect(branches[1]?.name).toBe('feature/x');
    expect(branches[1]?.current).toBe(false);
  });
});

describe('the blame', () => {
  it('reads the author of every line', () => {
    const blame = parseBlame(
      [
        'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\t1\t1\t1',
        'author Georgy',
        'author-mail <g@example.com>',
        'summary the change',
        'filename src/app.ts',
        '\tconst a = 1;'
      ].join('\n')
    );
    expect(blame).toHaveLength(1);
    expect(blame[0]).toEqual({ commit: 'a1b2c3d', author: 'Georgy', line: 1, text: 'const a = 1;' });
  });
});
