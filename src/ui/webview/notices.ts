import type { UiMessage } from '../protocol';

// The same failure can arrive twice, the panel shows it once.
export function appendNotice(messages: UiMessage[], text: string, id: string): UiMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === 'notice' && last.text === text) {
    return messages;
  }
  return [...messages, { id, role: 'notice', text }];
}
