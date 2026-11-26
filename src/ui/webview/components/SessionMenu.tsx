import { useEffect, useRef, useState } from 'react';
import type { UiSessionSummary } from '../../protocol';
import { IconClose, IconFolder, IconHistory, IconLayers, IconPlus } from '../icons';
import { visibleSessions } from '../sessionScope';
import { filterSessions, type SessionSearch } from '../sessionFilter';
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
  workspaceRoot,
  workspaceLabel,
  onSelect,
  onDelete,
  onNewChat,
  onSearch
}: {
  sessions: UiSessionSummary[];
  activeSessionId: string | undefined;
  // The project of the panel: the chats of the other projects are not shown
  // by default.
  workspaceRoot: string;
  workspaceLabel: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNewChat: () => void;
  onSearch: (query: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // The scope of the list: the chats of the project or the chats of every
  // project.
  const [all, setAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SessionSearch | undefined>(undefined);

  // The host answers the search by the text of the chats.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string } & SessionSearch;
      if (data?.type === 'session_search') {
        setSearch({ query: data.query, hits: data.hits });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // The text search waits for a pause in the typing.
  useEffect(() => {
    if (query.trim().length === 0) {
      return;
    }
    const timer = setTimeout(() => onSearch(query), 150);
    return () => clearTimeout(timer);
  }, [query, onSearch]);

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

  // The chats of the other projects stay in the list, they are hidden until
  // the reader asks for every chat.
  const visible = filterSessions(visibleSessions(sessions, workspaceRoot, all), query, search);

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
            className={'session-scope' + (all ? ' active' : '')}
            title={all ? STRINGS.allChats : STRINGS.thisProject}
            aria-pressed={all}
            onClick={() => setAll((value) => !value)}
          >
            {all ? <IconLayers /> : <IconFolder />}
            <span className="session-scope-label">
              {all ? STRINGS.allChats : workspaceLabel || STRINGS.thisProject}
            </span>
          </button>
          <input
            type="text"
            className="session-search"
            placeholder={STRINGS.searchChats}
            aria-label={STRINGS.searchChats}
            value={query}
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setOpen(false);
              }
            }}
          />
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
          {visible.length === 0 ? (
            <div className="session-empty">{query.trim() ? STRINGS.noChatsFound : STRINGS.noChats}</div>
          ) : null}
          {visible.map(({ session, snippet }) => (
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
                {all && session.workspaceLabel ? (
                  <span className="session-project">{session.workspaceLabel}</span>
                ) : null}
                <span className="session-time">{formatTime(session.updatedAt)}</span>
                {snippet ? <span className="session-snippet">{snippet}</span> : null}
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
