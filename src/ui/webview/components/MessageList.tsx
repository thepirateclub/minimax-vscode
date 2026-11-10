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
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onRetry: (id: string) => void;
  onRewind: (id: string) => void;
}) {
  // The buttons live only at the messages of the user: the request can
  // be taken back at any time and repeated after a failure. The answer
  // of the model shows the time of the step, the card of an approval
  // shows nothing.
  const isUser = message.role === 'user';
  const showRetry = isUser && canRetry;
  const hasActions = !message.approval && (showRetry || message.elapsedMs !== undefined);
  return (
    // The notice paints its own bar, the container of a message stays plain.
    <div
      className={
        message.role === 'notice' ? 'message' : 'message message-' + message.role
      }
    >
      {message.role === 'user' ? (
        // The arrow stands on the left of the words, it points at the
        // message it belongs to.
        <div className="user-row">
          <button
            className="message-rewind"
            title={STRINGS.rewind}
            aria-label={STRINGS.rewind}
            onClick={() => onRewind(message.id)}
          >
            <IconRewind />
          </button>
          <div className="bubble user-bubble">{message.text}</div>
        </div>
      ) : null}
      {message.role === 'assistant' ? (
        <div className="assistant-body">
          {message.thinking ? <ThinkingBlock text={message.thinking} /> : null}
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
          {showRetry ? (
            <button
              className="message-action"
              title={STRINGS.retry}
              aria-label={STRINGS.retry}
              onClick={() => onRetry(message.id)}
            >
              <IconRetry />
            </button>
          ) : null}
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

export function MessageList({
  messages,
  collapseTools,
  collapseCode,
  onApprove,
  onReject,
  onOpenFile,
  onRetry,
  onRewind
}: {
  messages: UiMessage[];
  // The cards of the actions fold to their title.
  collapseTools: boolean;
  // The code blocks of the answers fold to their header.
  collapseCode: boolean;
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string, line?: number) => void;
  onRetry: (id: string) => void;
  onRewind: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastState = useRef(measure([]));
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
    setVisible((value) => value + PAGE);
    // The place of the reader stays where it was.
    window.requestAnimationFrame(() => {
      const after = root?.scrollHeight ?? 0;
      if (root && after > before) {
        root.scrollTop += after - before;
      }
    });
  }, []);

  // The files the agent has read, a snippet of one of them gets the name
  // of the file in its header.
  const sources = collectFileSources(messages);
  // The request can be repeated only when the turn of it failed.
  const failed = failedRequests(messages);
  // The command that ran before every message of the chat.
  const commands = commandHints(messages);

  const shown = messages.length > visible ? messages.slice(-visible) : messages;
  const hidden = messages.length - shown.length;

  return (
    <div className="messages-wrap">
      <div className="messages" ref={listRef} onScroll={handleScroll}>
        {hidden > 0 ? (
          <button className="load-earlier" onClick={loadEarlier}>
            {STRINGS.showEarlier} ({hidden})
          </button>
        ) : null}
        {shown.map((message, offset) => (
          <MessageRow
            key={message.id}
            message={message}
            sources={sources}
            command={commands[messages.length - shown.length + offset]}
            collapseTools={collapseTools}
            collapseCode={collapseCode}
            canRetry={failed.has(message.id)}
            onApprove={onApprove}
            onReject={onReject}
            onOpenFile={onOpenFile}
            onRetry={onRetry}
            onRewind={onRewind}
          />
        ))}
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
