import { useState } from 'react';
import { Chevron, IconThinking } from '../icons';
import { STRINGS } from '../strings';

export function ThinkingBlock({
  text,
  repeated
}: {
  text: string;
  // The reasoning follows another reasoning without anything between them.
  // The row stands apart from the row before it, so the reader does not take
  // them for one block.
  repeated?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={'thinking' + (repeated ? ' thinking-repeated' : '')}>
      <button
        className="section-head thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Chevron open={open} />
        <span className="section-icon thinking-icon">
          <IconThinking />
        </span>
        <span className="section-title">{STRINGS.thinking}</span>
      </button>
      {open ? <pre className="thinking-body">{text}</pre> : null}
    </div>
  );
}
