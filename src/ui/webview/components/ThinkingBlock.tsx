import { useState } from 'react';
import { STRINGS } from '../strings';

export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking">
      <button className="thinking-toggle" onClick={() => setOpen((value) => !value)}>
        {STRINGS.thinking} {open ? '▾' : '▸'}
      </button>
      {open ? <pre className="thinking-body">{text}</pre> : null}
    </div>
  );
}
