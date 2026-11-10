import { IconThinking } from '../icons';
import { STRINGS } from '../strings';

// The first screen of a chat: what the agent does and the keys that matter,
// instead of a bare paragraph in the middle of the panel.
export function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-inner">
        <span className="empty-mark">
          <IconThinking />
        </span>
        <div className="empty-title">{STRINGS.emptyTitle}</div>
        <p className="empty-text">{STRINGS.empty}</p>
        <ul className="empty-hints">
          <li>
            <span className="empty-keys">
              <kbd>@</kbd>
            </span>
            <span>{STRINGS.emptyHintMention}</span>
          </li>
          <li>
            <span className="empty-keys">
              <kbd>Enter</kbd>
            </span>
            <span>{STRINGS.emptyHintSend}</span>
          </li>
          <li>
            <span className="empty-keys">
              <kbd>Shift</kbd>
              <kbd>Enter</kbd>
            </span>
            <span>{STRINGS.emptyHintNewLine}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
