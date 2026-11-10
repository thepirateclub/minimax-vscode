import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import type { UiMessage } from '../../protocol';
import { collectFileSources, type CodeSource } from '../codeBlock';
import { contentChanged, isAtBottom, measure, shouldFollow } from '../listScroll';
import { renderMarkdown } from '../markdown';
import { STRINGS } from '../strings';
import { ApprovalCard } from './ApprovalCard';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';

// The panel keeps the dom small, the older messages are loaded on demand.
const PAGE = 120;

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // The webview can refuse the clipboard, the fallback keeps the button alive.
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
}

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
  button.textContent = STRINGS.copied;
  window.setTimeout(() => {
    button.textContent = STRINGS.copy;
  }, 1200);
}

const MessageRow = memo(function MessageRow({
  message,
  sources,
  collapseTools,
  collapseCode,
  onApprove,
  onReject,
  onOpenFile
}: {
  message: UiMessage;
  sources: CodeSource[];
  collapseTools: boolean;
  collapseCode: boolean;
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string, line?: number) => void;
}) {
  return (
    // The notice paints its own bar, the container of a message stays plain.
    <div
      className={
        message.role === 'notice' ? 'message' : 'message message-' + message.role
      }
    >
      {message.role === 'user' ? (
        <div className="bubble user-bubble">{message.text}</div>
      ) : null}
      {message.role === 'assistant' ? (
        <div className="assistant-body">
          {message.thinking ? <ThinkingBlock text={message.thinking} /> : null}
          {message.text ? (
            <div
              className="markdown"
              onClick={(event) => handleMarkdownClick(event, onOpenFile)}
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(message.text, sources, { collapseCode })
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
    </div>
  );
});

export function MessageList({
  messages,
  collapseTools,
  collapseCode,
  onApprove,
  onReject,
  onOpenFile
}: {
  messages: UiMessage[];
  // The cards of the actions fold to their title.
  collapseTools: boolean;
  // The code blocks of the answers fold to their header.
  collapseCode: boolean;
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
  onOpenFile: (path: string, line?: number) => void;
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
        {shown.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            sources={sources}
            collapseTools={collapseTools}
            collapseCode={collapseCode}
            onApprove={onApprove}
            onReject={onReject}
            onOpenFile={onOpenFile}
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
