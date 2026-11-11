import type { ExtToWeb, UiMessage } from '../protocol';

// The result of the call goes into the last card with that id: the same id
// of a tool call can come back in a later turn, the card of the earlier turn
// keeps its own result. The rule lives in a module of its own, the panel
// is a React component and the tests of the panel run without a browser.
export function endTool(
  messages: UiMessage[],
  message: Extract<ExtToWeb, { type: 'tool_end' }>
): UiMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i--) {
    const item = next[i]!;
    if (item.tool && item.tool.id === message.id) {
      next[i] = {
        ...item,
        tool: {
          ...item.tool,
          content: message.content,
          isError: message.isError,
          running: false,
          diff: message.diff
        }
      };
      return next;
    }
  }
  return next;
}
