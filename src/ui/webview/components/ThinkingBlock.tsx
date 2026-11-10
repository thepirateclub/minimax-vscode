import { useState } from 'react';
import { Chevron } from '../icons';
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
        {STRINGS.thinking}
      </button>
      {open ? <pre className="thinking-body">{text}</pre> : null}
    </div>
  );
}
