import { memo } from 'react';
import type { MouseEvent } from 'react';
import type { UiMessage } from '../../protocol';
import type { CodeSource } from '../codeSources';
import type { CommandHint } from '../commandHistory';
import { IconClock, IconRetry, IconRewind } from '../icons';
import { formatDuration, formatStamp, fullStamp } from '../../format';
import { writeToClipboard } from '../clipboard';
import { renderMarkdown } from '../markdown';
import { STRINGS } from '../strings';
import { ApprovalCard } from './ApprovalCard';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';

// One row of the feed: the words of the reader, the answer of the model,
// the card of an action, the question of an approval. The list only places
// the rows and follows the answer.
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

export const MessageRow = memo(function MessageRow({
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
          <div className="user-stack">
            <div className="bubble user-bubble">{message.text}</div>
            {message.at !== undefined ? (
              <span className="message-time" title={STRINGS.startedAt + ' ' + fullStamp(message.at)}>
                {formatStamp(message.at)}
              </span>
            ) : null}
          </div>
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
        <ToolCard tool={message.tool} collapsed={collapseTools} {...(message.at !== undefined ? { at: message.at } : {})} />
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
            // The plate of the turn: how long the task ran and when it ended.
            <span className="turn-plate">
              <IconClock />
              <span className="turn-plate-elapsed" title={STRINGS.stepTime}>
                {STRINGS.turnDone} {formatDuration(message.elapsedMs)}
              </span>
              {message.endedAt !== undefined ? (
                <span className="turn-plate-stamp" title={STRINGS.turnEnded + ' ' + fullStamp(message.endedAt)}>
                  {formatStamp(message.endedAt)}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
