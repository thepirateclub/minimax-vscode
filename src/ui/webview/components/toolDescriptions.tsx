import type { UiToolCall } from '../../protocol';
import { filePaths, firstLine } from './toolCardHelpers';
import { IconRead } from '../icons';
import { DESCRIBERS, type ToolView } from './toolDescriptions/table';

export type { ToolView } from './toolDescriptions/table';
export { describerNames } from './toolDescriptions/table';

// The card shows what the agent did, not the name of the tool.
// A folded card hides its body, so the header has to name the command.
export function describe(tool: UiToolCall, folded: boolean): ToolView {
  const view = describeTool(tool, folded);
  const path = filePaths(tool.input)[0] ?? '';
  const result = (tool.content ?? '').split('\n')[0] ?? '';
  // The tool names the file in its result, the title of the card names it
  // already. The summary drops the echo and keeps the text of a failure.
  if (path.length > 0 && result.endsWith(path)) {
    return { ...view, summary: '' };
  }
  return view;
}

// The preview of a folded group of the actions: the last action in the words
// of its folded card, so the head of the group and the card read the same.
export function actionPreview(tool: UiToolCall): string {
  return describe(tool, true).title;
}

function describeTool(tool: UiToolCall, folded: boolean): ToolView {
  const input = tool.input;
  const paths = filePaths(input);
  const content = tool.content;
  const describer = DESCRIBERS[tool.name];
  if (describer) {
    return describer({ tool, input, paths, content, folded });
  }
  return {
    icon: <IconRead />,
    title: tool.name,
    summary: firstLine(content)
  };
}
