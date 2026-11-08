import { useState } from 'react';
import { STRINGS } from '../strings';

export function Composer({
  busy,
  mentions,
  onSend,
  onStop,
  onPickFiles,
  onRemoveMention
}: {
  busy: boolean;
  mentions: string[];
  onSend: (text: string, mentions: string[]) => void;
  onStop: () => void;
  onPickFiles: () => void;
  onRemoveMention: (path: string) => void;
}) {
  const [text, setText] = useState('');

  const submit = (): void => {
    if (text.trim().length === 0) {
      return;
    }
    onSend(text.trim(), mentions);
    setText('');
  };

  return (
    <div className="composer">
      {mentions.length > 0 ? (
        <div className="mentions">
          {mentions.map((path) => (
            <button
              key={path}
              className="mention"
              title="Remove attachment"
              onClick={() => onRemoveMention(path)}
            >
              {path} ×
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        value={text}
        placeholder={STRINGS.placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-actions">
        <button className="secondary" onClick={onPickFiles}>
          {STRINGS.attach}
        </button>
        {busy ? (
          <button onClick={onStop}>{STRINGS.stop}</button>
        ) : (
          <button onClick={submit}>{STRINGS.send}</button>
        )}
      </div>
    </div>
  );
}
