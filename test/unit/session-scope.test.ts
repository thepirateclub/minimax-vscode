import { describe, expect, it } from 'vitest';
import type { UiSessionSummary } from '../../src/ui/protocol';
import { visibleSessions } from '../../src/ui/webview/sessionScope';

function chat(
  id: string,
  workspaceRoot: string | undefined,
  workspaceLabel?: string
): UiSessionSummary {
  return {
    id,
    title: 'chat ' + id,
    updatedAt: 1,
    workspaceRoot,
    workspaceLabel
  };
}

describe('the scope of the list of the chats', () => {
  it('shows the chats of the project', () => {
    const visible = visibleSessions(
      [chat('a', 'C:/projects/alpha'), chat('b', 'C:/projects/beta')],
      'C:/projects/alpha',
      false
    );
    expect(visible.map((item) => item.id)).toEqual(['a']);
  });

  it('shows every chat with the switch of every chat', () => {
    const visible = visibleSessions(
      [chat('a', 'C:/projects/alpha'), chat('b', 'C:/projects/beta')],
      'C:/projects/alpha',
      true
    );
    expect(visible.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps the chat of an older version in the project of the panel', () => {
    const visible = visibleSessions([chat('old', undefined)], 'C:/projects/alpha', false);
    expect(visible.map((item) => item.id)).toEqual(['old']);
  });

  it('hides nothing of the project of the panel', () => {
    const visible = visibleSessions([chat('a', 'C:/projects/alpha')], 'C:/projects/alpha', false);
    expect(visible).toHaveLength(1);
  });
});
