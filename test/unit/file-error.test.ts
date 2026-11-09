import { describe, expect, it } from 'vitest';
import { fileErrorMessage } from '../../src/ui/fileError';

describe('the failure of an opened file', () => {
  it('says that the file does not exist', () => {
    const message = fileErrorMessage(
      'demo-diff.txt',
      "cannot open file:///h%3A/personal_project/minimax-vscode/demo-diff.txt. Detail: Unable to read file 'h:\\personal_project\\minimax-vscode\\demo-diff.txt' (Error: Unable to resolve nonexistent file 'h:\\personal_project\\minimax-vscode\\demo-diff.txt')"
    );
    expect(message).toBe('Cannot open demo-diff.txt: the file does not exist.');
  });

  it('says that the path is outside the workspace', () => {
    const message = fileErrorMessage('../outside.ts', 'path escapes the workspace root: ../outside.ts');
    expect(message).toBe('Cannot open ../outside.ts: the path is outside the workspace.');
  });

  it('keeps the dump of the editor out of the panel', () => {
    const message = fileErrorMessage('a.ts', 'cannot open file:///c%3A/work/a.ts. Detail: boom');
    expect(message).not.toContain('file://');
    expect(message).not.toContain('Detail:');
  });

  it('keeps a short reason of another failure', () => {
    const message = fileErrorMessage('a.ts', 'the file is locked by another program');
    expect(message).toBe('Cannot open a.ts: the file is locked by another program');
  });
});
