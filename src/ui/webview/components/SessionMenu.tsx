import { useEffect, useRef, useState } from 'react';
import type { UiSessionSummary } from '../../protocol';
import { IconClose, IconHistory, IconPlus } from '../icons';
import { STRINGS } from '../strings';

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) {
    return STRINGS.today + ' ' + time;
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) {
    return STRINGS.yesterday + ' ' + time;
  }
  return date.toLocaleDateString() + ' ' + time;
}

export function SessionMenu({
  sessions,
  activeSessionId,
  onSelect,
  onDelete,
  onNewChat
}: {
  sessions: UiSessionSummary[];
  activeSessionId: string | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="session-menu" ref={rootRef}>
      <button
        className={'icon-button' + (open ? ' open' : '')}
        title={STRINGS.chatHistory}
        aria-label={STRINGS.chatHistory}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconHistory />
      </button>
      {open ? (
        <div className="session-menu-list">
          <button
            className="session-new"
            onClick={() => {
              setOpen(false);
              onNewChat();
            }}
          >
            <IconPlus />
            {STRINGS.newChat}
          </button>
          {sessions.length === 0 ? (
            <div className="session-empty">{STRINGS.noChats}</div>
          ) : null}
          {sessions.map((session) => (
            <div
              key={session.id}
              className={'session-item' + (session.id === activeSessionId ? ' active' : '')}
            >
              <button
                className="session-open"
                onClick={() => {
                  setOpen(false);
                  onSelect(session.id);
                }}
              >
                <span className="session-title">{session.title}</span>
                <span className="session-time">{formatTime(session.updatedAt)}</span>
              </button>
              <button
                className="session-delete"
                title={STRINGS.deleteChat}
                aria-label={STRINGS.deleteChat}
                onClick={() => onDelete(session.id)}
              >
                <IconClose />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
