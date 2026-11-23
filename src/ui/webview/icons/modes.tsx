import type { ReactNode } from 'react';
import { CARET_PATH } from '../iconPaths';
import { Svg } from './base';

export function IconPlan(): ReactNode {
  // lucide "list-checks"
  return (
    <Svg>
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </Svg>
  );
}

// Angle brackets, the agent edits files in code mode.

export function IconCode(): ReactNode {
  // lucide "code"
  return (
    <Svg>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </Svg>
  );
}

// A chip, the model runs on the server.

export function IconModel(): ReactNode {
  // lucide "cpu"
  return (
    <Svg>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
    </Svg>
  );
}

// A spark, the model thinks before it answers.

export function IconThinking(): ReactNode {
  // lucide "sparkles"
  return (
    <Svg>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
    </Svg>
  );
}

// A target of the lucide set, the field takes the goal instead of a request.

export function IconGoal(): ReactNode {
  // lucide "target"
  return (
    <Svg>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  );
}

// A microphone of the lucide set, the request is spoken instead of typed.

export function IconMic(): ReactNode {
  // lucide "mic"
  return (
    <Svg>
      <path d="M12 19v3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <rect x="9" y="2" width="6" height="13" rx="3" />
    </Svg>
  );
}

// A paperclip, it attaches files to the request.

export function IconAttach(): ReactNode {
  // lucide "paperclip"
  return (
    <Svg>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  );
}

// A chevron of the lucide set, it opens a menu.

export function IconCaret(): ReactNode {
  // lucide "chevron-down"
  return (
    <Svg>
      <path d={CARET_PATH} />
    </Svg>
  );
}

// A cross of the lucide set, it opens a new chat.

export function IconPlus(): ReactNode {
  // lucide "plus"
  return (
    <Svg>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Svg>
  );
}

// An x of the lucide set, it removes a chat or a chip.

export function IconClose(): ReactNode {
  // lucide "x"
  return (
    <Svg>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Svg>
  );
}

// The chevron of a folding block. It points down when the block is open,
// the closed state turns it to the right with css, so one icon serves both.

export function Chevron({ open }: { open: boolean }): ReactNode {
  return (
    <span className={'chevron' + (open ? ' chevron-open' : '')} aria-hidden="true">
      <IconCaret />
    </span>
  );
}

// A page with lines, the agent reads a file.
