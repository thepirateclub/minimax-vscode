import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { UiMessage } from '../../protocol';
import { collectFileSources, type CodeSource } from '../codeBlock';
import { commandHints, type CommandHint } from '../commandHistory';
import { failedRequests } from '../failedRequests';
import { IconRetry, IconRewind } from '../icons';
import { contentChanged, isAtBottom, measure, shouldFollow } from '../listScroll';
import { formatDuration } from '../../format';
import { writeToClipboard } from '../clipboard';
import { renderMarkdown } from '../markdown';
import { STRINGS } from '../strings';
import { ApprovalCard } from './ApprovalCard';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';
import { ToolSteps } from './ToolSteps';
import { groupToolSteps, type FeedItem } from '../toolSteps';

// The panel keeps the dom small, the older messages are loaded on demand.
const PAGE = 120;

function handleMarkdownClick(
  event: MouseEvent<HTMLDivElement>,
  onOpenFile: (path: string, line?: number) => void
): void {
  const target = event.target as HTMLElement;
  if (target.closest('.code-toggle')) {
    toggleCodeBlock(event);
    return;
  }
  const file = target.closest('.code-file');
  if (file instanceof HTMLElement) {
    const path = file.dataset['path'] ?? '';
    if (path.length > 0) {
      const line = Number(file.dataset['line'] ?? '0');
      onOpenFile(path, line > 0 ? line : undefined);
    }
    return;
  }
  copyCode(event);
}

// The toggle of a code block folds the code, the header stays.
function toggleCodeBlock(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement;
  const toggle = target.closest('.code-toggle');
  if (!toggle) {
    return;
  }
  const block = toggle.closest('.code-block');
  if (!(block instanceof HTMLElement)) {
    return;
  }
  // The chevron turns with the class of the block, the icon stays in place.
  const collapsed = block.classList.toggle('collapsed');
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  toggle.setAttribute('aria-label', collapsed ? STRINGS.codeShow : STRINGS.codeHide);
}

function copyCode(event: MouseEvent<HTMLDivElement>): void {
  const target = event.target as HTMLElement;
  const button = target.closest('.code-copy');
  if (!button) {
    return;
  }
  const block = button.closest('.code-block');
  const code = block?.querySelector('code')?.textContent ?? '';
  void writeToClipboard(code);
  // The icon turns into a check for a moment, the css swaps the two icons.
  button.classList.add('copied');
  button.setAttribute('aria-label', STRINGS.copied);
  window.setTimeout(() => {
    button.classList.remove('copied');
    button.setAttribute('aria-label', STRINGS.copy);
  }, 1200);
}

const MessageRow = memo(function MessageRow({
  message,
  sources,
  command,
  collapseTools,
  collapseCode,
  canRetry,
  repeatedThinking,
  onApprove,
  onReject,
  onOpenFile,
  onRetry,
  onRewind
}: {
  message: UiMessage;
  sources: CodeSource[];
  // The command that ran before the message, a block can be named after it.
  command?: CommandHint;
  collapseTools: boolean;
  collapseCode: boolean;
  // The turn of the request failed, the request can be repeated.
  canRetry: boolean;
  // The reasoning follows another reasoning, the row stands apart from it.
  repeatedThinking: boolean;
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onRetry: (id: string) => void;
  onRewind: (id: string) => void;
}) {
  // Only one of the two buttons stands at the message of the user: the
  // request goes back, or it runs again after a failure. The answer of
  // the model shows the time of the step, the card of an approval shows
  // nothing.
  const isUser = message.role === 'user';
  const showRetry = isUser && canRetry;
  const hasActions = !message.approval && message.elapsedMs !== undefined;
  return (
    // The notice paints its own bar, the container of a message stays plain.
    <div
      className={
        message.role === 'notice' ? 'message' : 'message message-' + message.role
      }
    >
      {message.role === 'user' ? (
        // The button stands on the left of the words, it points at the
        // message it belongs to. It either takes the chat back to the
        // request or runs the request again, never both at once.
        <div className="user-row">
          {showRetry ? (
            <button
              className="message-retry"
              title={STRINGS.retry}
              aria-label={STRINGS.retry}
              onClick={() => onRetry(message.id)}
            >
              <IconRetry />
            </button>
          ) : (
            <button
              className="message-rewind"
              title={STRINGS.rewind}
              aria-label={STRINGS.rewind}
              onClick={() => onRewind(message.id)}
            >
              <IconRewind />
            </button>
          )}
          <div className="bubble user-bubble">{message.text}</div>
        </div>
      ) : null}
      {message.role === 'assistant' ? (
        <div className="assistant-body">
          {message.thinking ? (
            <ThinkingBlock
              text={message.thinking}
              repeated={repeatedThinking}
            />
          ) : null}
          {message.text ? (
            <div
              className="markdown"
              onClick={(event) => handleMarkdownClick(event, onOpenFile)}
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(message.text, sources, { collapseCode, command })
              }}
            />
          ) : null}
        </div>
      ) : null}
      {message.role === 'notice' ? (
        <div className="message-notice">{message.text}</div>
      ) : null}
      {message.role === 'tool' && message.tool ? (
        <ToolCard tool={message.tool} collapsed={collapseTools} />
      ) : null}
      {message.approval ? (
        <ApprovalCard
          message={message}
          onApprove={(allowForSession) => onApprove(message.approval!.id, allowForSession)}
          onReject={() => onReject(message.approval!.id)}
        />
      ) : null}
      {hasActions ? (
        <div className="message-actions">
          {message.elapsedMs !== undefined ? (
            <span className="message-elapsed" title={STRINGS.stepTime}>
              {formatDuration(message.elapsedMs)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

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
  onRewind
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
    if (next.count < previous.count) {
      // Another chat was opened, the list shows its end.
      root.scrollTop = root.scrollHeight;
      atBottomRef.current = true;
      setAtBottom(true);
      setPending(0);
      return;
    }
    if (!contentChanged(previous, next)) {
      return;
    }
    if (shouldFollow(previous, next, atBottomRef.current)) {
      root.scrollTop = root.scrollHeight;
      return;
    }
    setPending((value) => value + 1);
  }, [messages]);

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
    }
  }, []);

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
  const sources = collectFileSources(messages);
  // The request can be repeated only when the turn of it failed.
  const failed = failedRequests(messages);
  // The command that ran before every message of the chat.
  const commands = commandHints(messages);
  // The command of a message by its id: the steps of the tools break the
  // order of the feed, the index of the message is not its place anymore.
  const commandsById = new Map<string, CommandHint | undefined>();
  messages.forEach((message, index) => {
    commandsById.set(message.id, commands[index]);
  });

  const shown = messages.length > visible ? messages.slice(-visible) : messages;
  const hidden = messages.length - shown.length;
  // The messages the panel does not draw yet: the ones it holds and the
  // ones the host keeps.
  const pendingCount = hidden + olderMessages;
  // The feed of the chat, the steps of the actions and the messages of the
  // model in the order they came.
  const feed = groupToolSteps(shown);

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
