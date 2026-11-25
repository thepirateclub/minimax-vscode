import type { UiSelection } from '../ui/protocol';

// The requests the editor commands send. The model reads English, so the
// texts are English; the code of the selection goes with the request as a
// selection block, the way a chip of the composer goes.

export const EXPLAIN_REQUEST =
  'Explain the selected code: what it does, how it works step by step, the non-obvious parts and the possible pitfalls. Do not change any file.';

export const DEFAULT_IMPROVE_PROMPT =
  'Improve the marked region of the file: make it clearer, safer and simpler while keeping its behavior and public interface. ' +
  'Fix real bugs you find there. Keep the style, naming and formatting of the file. ' +
  'Edit only the marked region with edit_file unless a change outside it is required for the code to compile; say why if so. ' +
  'After the edit, explain the changes in a short list.';

export const COMMENT_PROMPT =
  'Add comments to the marked region of the file in the comment syntax of its language. ' +
  'Explain why the code does what it does, the intent, the non-obvious decisions and the pitfalls; do not restate what a line plainly says. ' +
  'Keep existing comments unless they are wrong. Do not change the code itself. Edit only the marked region with edit_file.';

// The block of one selection in the text of the request. A note is the
// annotation of the reader: what they want about this exact piece.
export function selectionBlock(selection: UiSelection): string {
  const header =
    'Selected code from ' + selection.path + (selection.detail ? ' (' + selection.detail + ')' : '');
  const note = selection.note?.trim() ? '\nNote of the user about this code: ' + selection.note.trim() : '';
  return header + ':' + note + '\n' + (selection.content ?? '');
}

// The request to improve a region. The whole file goes with it: an edit
// of a piece without its surroundings breaks the names and the types the
// piece uses. The lines carry numbers, the region is marked by them. The
// request is what the reader sees in the chat, the file goes as context.
export function improveRequest(input: {
  path: string;
  startLine: number;
  endLine: number;
  fileText: string;
  instruction?: string;
}): { request: string; context: string } {
  const instruction = input.instruction?.trim() || DEFAULT_IMPROVE_PROMPT;
  const lines = input.fileText.replace(/\r\n/g, '\n').split('\n');
  const width = String(lines.length).length;
  const context = lines
    .map((line, index) => {
      const number = index + 1;
      const mark = number >= input.startLine && number <= input.endLine ? '>' : ' ';
      return mark + String(number).padStart(width) + ' | ' + line;
    })
    .join('\n');
  return {
    request:
      instruction + '\n\nThe marked region: ' + input.path + ' lines ' + input.startLine + '-' + input.endLine + '.',
    context
  };
}

// The header of the whole file in the request: the marks and numbers are
// not part of the text, edit_file takes the text without them.
export function wholeFileDetail(startLine: number, endLine: number): string {
  return 'the whole file, the region ' + startLine + '-' + endLine + ' is marked with `>`, the marks and line numbers are not part of the text';
}
