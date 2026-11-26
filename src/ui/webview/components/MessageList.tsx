import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UiMessage } from '../../protocol';
import { collectFileSources } from '../codeBlock';
import { commandHints, type CommandHint } from '../commandHistory';
import { failedRequests } from '../failedRequests';
import { feedAction, isAtBottom, measure } from '../listScroll';
import { STRINGS } from '../strings';
import { MessageRow } from './MessageRow';
import { ToolSteps } from './ToolSteps';
import { groupToolSteps, type FeedItem } from '../toolCard';

// The panel keeps the dom small, the older messages are loaded on demand.
const PAGE = 120;

// The reasoning follows another reasoning without anything between them:
// the row stands apart from the row before it.
function isRepeatedThinking(previous: FeedItem | undefined): boolean {
  if (!previous || previous.kind !== 'message') {
    return false;
  }
  const message = previous.message;
  if (message.role !== 'assistant' || !message.thinking) {
    return false;
  }
  return (message.text?.length ?? 0) === 0;
}

export function MessageList({
  messages,
  olderMessages,
  onLoadOlder,
  collapseTools,
  collapseCode,
  showToolSteps,
  onApprove,
  onReject,
  onOpenFile,
  onRetry,
  onRewind,
  followEnd,
  onFollowEnd
}: {
  messages: UiMessage[];
  // How many messages of the chat wait in the host. The panel asks for
  // them when the reader wants to see the older part of the chat.
  olderMessages: number;
  // The panel asks the host for the older part of the chat.
  onLoadOlder: () => void;
  // The cards of the actions fold to their title.
  collapseTools: boolean;
  // The code blocks of the answers fold to their header.
  collapseCode: boolean;
  // The steps of the tools are shown in the feed.
  showToolSteps: boolean;
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onRetry: (id: string) => void;
  onRewind: (id: string) => void;
  // The feed goes to the end of the history: the chat was replaced or
  // the request runs again. The feed follows the new turn, whatever place
  // the reader had.
  followEnd: boolean;
  // The reader took the place of the feed, the feed does not pull itself
  // down any more.
  onFollowEnd: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastState = useRef(measure([]));
  // The height of the list before the older messages came from the host.
  // The place of the reader stays where it was.
  const pendingScroll = useRef<number | undefined>(undefined);
  const [visible, setVisible] = useState(PAGE);
  const [atBottom, setAtBottom] = useState(true);
  const [pending, setPending] = useState(0);

  const scrollToBottom = useCallback((): void => {
    const root = listRef.current;
    if (!root) {
      return;
    }
    root.scrollTop = root.scrollHeight;
    atBottomRef.current = true;
    setAtBottom(true);
    setPending(0);
  }, []);

  // The list follows the answer while the reader stays at the bottom. A
  // streamed text grows inside the same message, the size of the content
  // tells that the list has to move, not the number of the messages.
  useEffect(() => {
    const root = listRef.current;
    if (!root) {
      return;
    }
    const next = measure(messages);
    const previous = lastState.current;
    lastState.current = next;
    const before = pendingScroll.current;
    if (before !== undefined) {
      // The older messages came from the host: the place of the reader
      // stays where it was, the list does not jump to the end.
      pendingScroll.current = undefined;
      window.requestAnimationFrame(() => {
        const after = root.scrollHeight;
        if (after > before) {
          root.scrollTop += after - before;
        }
      });
      return;
    }
    const action = feedAction(previous, next, atBottomRef.current, followEnd);
    if (action === 'keep') {
      return;
    }
    if (action === 'bottom') {
      // The feed goes to the end of the history: another chat was opened, or
      // the request runs again and the reader waits for the new turn.
      root.scrollTop = root.scrollHeight;
      atBottomRef.current = true;
      setAtBottom(true);
      setPending(0);
      return;
    }
    setPending((value) => value + 1);
  }, [messages, followEnd]);

  const handleScroll = useCallback((): void => {
    const root = listRef.current;
    if (!root) {
      return;
    }
    const bottom = isAtBottom(root.scrollHeight, root.scrollTop, root.clientHeight);
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) {
      setPending(0);
      return;
    }
    if (followEnd) {
      // The reader scrolled up: he took the place of the feed, the feed
      // does not pull itself down any more.
      onFollowEnd();
    }
  }, [followEnd, onFollowEnd]);

  const loadEarlier = useCallback((): void => {
    const root = listRef.current;
    const before = root?.scrollHeight ?? 0;
    if (messages.length > visible) {
      // The panel holds these messages, it draws them by itself.
      setVisible((value) => value + PAGE);
      // The place of the reader stays where it was.
      window.requestAnimationFrame(() => {
        const after = root?.scrollHeight ?? 0;
        if (root && after > before) {
          root.scrollTop += after - before;
        }
      });
      return;
    }
    // The chat is longer than the panel holds: the older part of it waits
    // in the host, the panel asks for it.
    pendingScroll.current = before;
    onLoadOlder();
  }, [messages.length, visible, onLoadOlder]);

  // The files the agent has read, a snippet of one of them gets the name
  // of the file in its header.
  // The lists walk the whole chat: they are counted once per change of the
  // messages, not on every render of the feed (scroll, the visible window).
  const sources = useMemo(() => collectFileSources(messages), [messages]);
  // The request can be repeated only when the turn of it failed.
  const failed = useMemo(() => failedRequests(messages), [messages]);
  // The command of a message by its id: the steps of the tools break the
  // order of the feed, the index of the message is not its place anymore.
  const commandsById = useMemo(() => {
    const commands = commandHints(messages);
    const byId = new Map<string, CommandHint | undefined>();
    messages.forEach((message, index) => {
      byId.set(message.id, commands[index]);
    });
    return byId;
  }, [messages]);

  const shown = useMemo(
    () => (messages.length > visible ? messages.slice(-visible) : messages),
    [messages, visible]
  );
  const hidden = messages.length - shown.length;
  // The messages the panel does not draw yet: the ones it holds and the
  // ones the host keeps.
  const pendingCount = hidden + olderMessages;
  // The feed of the chat, the steps of the actions and the messages of the
  // model in the order they came.
  const feed = useMemo(() => groupToolSteps(shown), [shown]);

  return (
    <div className="messages-wrap">
      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {pendingCount > 0 ? (
          <button className="load-earlier" onClick={loadEarlier}>
            {STRINGS.showEarlier} ({pendingCount})
          </button>
        ) : null}
        {feed.map((item, index) =>
          item.kind === 'steps' ? (
            // The setting hides the steps of the tools, the reader then sees
            // the text of the model only.
            showToolSteps ? (
              <ToolSteps
                key={item.step.id}
                step={item.step}
                collapsed={collapseTools}
              />
            ) : null
          ) : item.message.role === 'tool' && !showToolSteps ? (
            // The card of a sub-agent stands outside of the steps, the
            // setting hides it with them.
            null
          ) : (
            <MessageRow
              key={item.message.id}
              message={item.message}
              sources={sources}
              command={commandsById.get(item.message.id)}
              collapseTools={collapseTools}
              collapseCode={collapseCode}
              canRetry={failed.has(item.message.id)}
              repeatedThinking={isRepeatedThinking(feed[index - 1])}
              onApprove={onApprove}
              onReject={onReject}
              onOpenFile={onOpenFile}
              onRetry={onRetry}
              onRewind={onRewind}
            />
          )
        )}
      </div>
      {!atBottom ? (
        <button className="jump-latest" onClick={scrollToBottom}>
          {STRINGS.jumpToLatest}
          {pending > 0 ? ' (' + pending + ')' : ''}
        </button>
      ) : null}
    </div>
  );
}
