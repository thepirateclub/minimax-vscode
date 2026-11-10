import type { UiMessage } from '../protocol';

// The request of the user can be repeated only when the turn failed. While
// everything works the button would be noise in the chat.
export function failedRequests(messages: UiMessage[]): Set<string> {
  const failed = new Set<string>();
  let current: string | undefined;
  for (const message of messages) {
    if (message.role === 'user') {
      // Every request starts clean, a failure belongs to the request that
      // stands above it.
      current = message.id;
      continue;
    }
    if (current === undefined) {
      continue;
    }
    if (isFailure(message)) {
      failed.add(current);
    }
  }
  return failed;
}

// A failure of the panel is a notice of the kind error, a failed action is a
// card with the red mark. A note or a warning is not a failure.
function isFailure(message: UiMessage): boolean {
  if (message.role === 'notice') {
    return message.kind === 'error';
  }
  if (message.role === 'tool') {
    return message.tool?.isError === true;
  }
  return false;
}
