import { useEffect, useState } from 'react';
import { writeToClipboard } from '../clipboard';
import { IconCheck, IconCopy } from '../icons';
import { STRINGS } from '../strings';

// How long the check stays after a copy.
const CONFIRM_MS = 1200;

// The copy button of a block. A copy without a sign looked like a dead
// click, so the icon turns into a check for a moment.
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const label = copied ? STRINGS.copied : STRINGS.copy;
  return (
    <button
      className={'tool-copy' + (copied ? ' copied' : '')}
      title={label}
      aria-label={label}
      onClick={() => {
        void writeToClipboard(text);
        setCopied(true);
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}
