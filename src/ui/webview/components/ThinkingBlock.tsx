import { useState } from 'react';
import { Chevron, IconThinking } from '../icons';
import { STRINGS } from '../strings';

export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <button
        className="thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Chevron open={open} />
        <span className="thinking-icon">
          <IconThinking />
        </span>
        {STRINGS.thinking}
      </button>
      {open ? <pre className="thinking-body">{text}</pre> : null}
    </div>
  );
}
