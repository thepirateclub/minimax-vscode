import { describe, expect, it } from 'vitest';
import { DEFAULT_IMPROVE_PROMPT, improveRequest, selectionBlock, wholeFileDetail } from '../../src/agent/editorPrompts';

describe('selection block', () => {
  it('carries the note of an annotation before the code', () => {
    const block = selectionBlock({ id: 's', path: 'src/a.ts', label: 'a.ts', detail: 'lines 2-3', content: 'x();', note: ' why slow? ' });
    expect(block).toBe('Selected code from src/a.ts (lines 2-3):\nNote of the user about this code: why slow?\nx();');
  });

  it('stays as before without a note', () => {
    expect(selectionBlock({ id: 's', path: 'a.ts', label: 'a.ts', content: 'y' })).toBe('Selected code from a.ts:\ny');
  });
});

describe('improve request', () => {
  const fileText = 'one\r\ntwo\r\nthree\r\nfour';

  it('sends the whole file with the region marked', () => {
    const { request, context } = improveRequest({ path: 'a.ts', startLine: 2, endLine: 3, fileText });
    expect(request.startsWith(DEFAULT_IMPROVE_PROMPT)).toBe(true);
    expect(request).toContain('a.ts lines 2-3');
    expect(context.split('\n')).toEqual([' 1 | one', '>2 | two', '>3 | three', ' 4 | four']);
  });

  it('takes the prompt of the settings', () => {
    const { request } = improveRequest({ path: 'a.ts', startLine: 1, endLine: 1, fileText, instruction: 'Make it faster.' });
    expect(request.startsWith('Make it faster.')).toBe(true);
  });

  it('names the marks in the detail', () => {
    expect(wholeFileDetail(4, 9)).toContain('4-9');
  });
});

describe('comment request', () => {
  it('uses the comment prompt over the whole file', async () => {
    const { COMMENT_PROMPT } = await import('../../src/agent/editorPrompts');
    const { request } = improveRequest({ path: 'a.ts', startLine: 1, endLine: 1, fileText: 'x', instruction: COMMENT_PROMPT });
    expect(request).toContain('Do not change the code itself');
  });
});
