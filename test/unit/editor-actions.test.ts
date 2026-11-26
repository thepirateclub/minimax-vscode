import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: Array<{ text: string; selections: unknown[] }> = [];
const shown: string[] = [];
const state: { editor: unknown; input: string | undefined; prompt: string | undefined } = {
  editor: undefined,
  input: undefined,
  prompt: undefined
};

vi.mock('vscode', () => ({
  window: {
    get activeTextEditor() {
      return state.editor;
    },
    showInformationMessage: (text: string) => {
      shown.push(text);
      return Promise.resolve(undefined);
    },
    showInputBox: async () => state.input
  },
  workspace: {
    asRelativePath: (uri: { path: string }) => uri.path,
    getConfiguration: () => ({ inspect: () => ({ globalValue: state.prompt }) })
  },
  commands: { registerCommand: () => ({ dispose: () => undefined }) }
}));
vi.mock('../../src/host/turn', () => ({
  handleSend: async (_host: unknown, text: string, _mentions: unknown, selections: unknown[]) => {
    sent.push({ text, selections });
  }
}));
vi.mock('../../src/host/workspace', () => ({ addSelectionToChat: () => undefined }));

const { annotateSelection, explainSelection, improveSelection } = await import('../../src/host/editorActions');

const fileText = 'line one\nline two\nline three\nline four';
function editor(startLine: number, endLine: number, endCharacter = 4) {
  return {
    selection: {
      isEmpty: false,
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: endCharacter }
    },
    document: {
      uri: { path: 'src/a.ts' },
      getText: (range?: unknown) => (range ? 'line two' : fileText)
    }
  };
}

const posted: unknown[] = [];
let counter = 0;
const host = {
  nextId: (prefix: string) => prefix + ++counter,
  panel: { reveal: () => undefined, post: (message: unknown) => posted.push(message) }
} as never;

beforeEach(() => {
  sent.length = 0;
  shown.length = 0;
  posted.length = 0;
  state.editor = undefined;
  state.input = undefined;
  state.prompt = undefined;
});

describe('the commands of the editor', () => {
  it('ask for a selection first', async () => {
    await explainSelection(host);
    await improveSelection(host);
    expect(sent).toEqual([]);
    expect(shown).toEqual(['MiniMax: select the code first.', 'MiniMax: select the code first.']);
  });

  it('explain the selected lines at once', async () => {
    state.editor = editor(1, 1);
    await explainSelection(host);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.selections).toEqual([
      expect.objectContaining({ path: 'src/a.ts', label: 'a.ts', detail: 'lines 2-2', content: 'line two' })
    ]);
  });

  it('pin an annotation above the field, a cancel pins nothing', async () => {
    state.editor = editor(1, 1);
    await annotateSelection(host);
    expect(posted).toEqual([]);
    state.input = '  why so slow?  ';
    await annotateSelection(host);
    expect(posted).toEqual([{ type: 'selection', selection: expect.objectContaining({ note: 'why so slow?' }) }]);
    expect(sent).toEqual([]);
  });

  it('improve with the whole file and the prompt of the user', async () => {
    state.editor = editor(1, 2, 0);
    state.prompt = 'make it faster';
    await improveSelection(host);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain('make it faster');
    const [file] = sent[0]!.selections as Array<{ content: string }>;
    // The selection ends at the start of line 3: that line is not taken.
    expect(file!.content).toContain('>2 | line two');
    expect(file!.content).toContain(' 3 | line three');
    expect(file!.content).toContain('line four');
  });
});
