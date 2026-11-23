import type { ReactNode } from 'react';
import type { QueueState, UiQueuedMessage } from '../../protocol';
import { IconAlert, IconCheck, IconClock, IconClose, IconRefresh, IconSend } from '../icons';
import { STRINGS } from '../strings';

// The state of a message in the queue: it waits, it goes out, it is sent or
// it failed.
function stateIcon(state: QueueState): ReactNode {
  if (state === 'sending') {
    return <IconRefresh />;
  }
  if (state === 'done') {
    return <IconCheck />;
  }
  if (state === 'error') {
    return <IconAlert />;
  }
  return <IconClock />;
}

function stateName(state: QueueState): string {
  if (state === 'sending') {
    return STRINGS.queueSending;
  }
  if (state === 'done') {
    return STRINGS.queueDone;
  }
  if (state === 'error') {
    return STRINGS.queueError;
  }
  return STRINGS.queueWaiting;
}

// The queue of the messages of the chat, a compact strip over the field of
// the request.
export function QueueBar({
  items,
  onSend,
  onSendAll,
  onRemove
}: {
  items: UiQueuedMessage[];
  onSend: (id: string) => void;
  onSendAll: () => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="queue-bar" role="list" aria-label={STRINGS.queueTitle}>
      <div className="queue-items">
        {items.map((item) => (
          <span
            key={item.id}
            className={'queue-item queue-' + item.state}
            role="listitem"
            title={item.error ?? item.text}
          >
            <span className="queue-state" title={stateName(item.state)}>
              {stateIcon(item.state)}
            </span>
            <span className="queue-text">{item.text}</span>
            <button
              className="queue-send"
              title={STRINGS.queueSend}
              aria-label={STRINGS.queueSend}
              disabled={item.state === 'sending'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSend(item.id)}
            >
              <IconSend />
            </button>
            <button
              className="queue-remove"
              title={STRINGS.queueRemove}
              aria-label={STRINGS.queueRemove}
              disabled={item.state === 'sending'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRemove(item.id)}
            >
              <IconClose />
            </button>
          </span>
        ))}
      </div>
      <button
        className="queue-send-all"
        title={STRINGS.queueSendAll}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onSendAll}
      >
        <IconSend />
        {STRINGS.queueSendAll}
      </button>
    </div>
  );
}
