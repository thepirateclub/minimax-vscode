import { useState } from 'react';
import { Chevron, IconThinking } from '../icons';
import { STRINGS } from '../strings';
import { thinkingPreview } from '../sectionPreview';
import { SectionPreview } from './SectionPreview';

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
      <div className="section-head thinking-head">
        <button
          className="section-toggle thinking-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Chevron open={open} />
          <span className="section-icon thinking-icon">
            <IconThinking />
          </span>
          <span className="section-title">{STRINGS.thinking}</span>
        </button>
        {open ? null : (
          // The folded reasoning shows its first words in the free middle of
          // the head: the reader sees what the model thought about without
          // reading all of it.
          <SectionPreview
            text={thinkingPreview(text)}
            onOpen={() => setOpen(true)}
          />
        )}
      </div>
      {open ? <pre className="thinking-body">{text}</pre> : null}
    </div>
  );
}
