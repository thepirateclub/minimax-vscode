import MarkdownIt from 'markdown-it';
import type { UiMessage } from '../../protocol';
import { ApprovalCard } from './ApprovalCard';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCard } from './ToolCard';

const md = new MarkdownIt({ breaks: true, linkify: true });

export function MessageList({
  messages,
  onApprove,
  onReject
}: {
  messages: UiMessage[];
  onApprove: (id: string, allowForSession: boolean) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="messages">
      {messages.map((message) => (
        <div key={message.id} className={'message message-' + message.role}>
          {message.role === 'user' ? (
            <div className="bubble user-bubble">{message.text}</div>
          ) : null}
          {message.role === 'assistant' ? (
            <div className="assistant-body">
              {message.thinking ? <ThinkingBlock text={message.thinking} /> : null}
              {message.text ? (
                <div
                  className="markdown"
                  dangerouslySetInnerHTML={{ __html: md.render(message.text) }}
                />
              ) : null}
            </div>
          ) : null}
          {message.role === 'tool' && message.tool ? <ToolCard tool={message.tool} /> : null}
          {message.approval ? (
            <ApprovalCard
              message={message}
              onApprove={(allowForSession) => onApprove(message.approval!.id, allowForSession)}
              onReject={() => onReject(message.approval!.id)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
