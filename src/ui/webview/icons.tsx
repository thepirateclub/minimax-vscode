// Inline SVG icons, the panel inherits the theme colors from the host.
import type { ReactNode } from 'react';
import { CODICON_DEBUG_STOP, CODICON_SEND } from './codicons';
import { CARET_PATH, CHECK_PATH, COPY_PATH, COPY_RECT } from './iconPaths';

interface IconProps {
  size?: number;
}

function Svg({
  size = 14,
  viewBox = '0 0 16 16',
  strokeWidth = 1.4,
  filled = false,
  children
}: IconProps & {
  viewBox?: string;
  strokeWidth?: number;
  filled?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox={viewBox}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// A checklist, the agent only reads in plan mode.
export function IconPlan(): ReactNode {
  // lucide "list-checks"
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
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
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </Svg>
  );
}

// A chip, the model runs on the server.
export function IconModel(): ReactNode {
  // lucide "cpu"
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
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
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4M22 5h-4M4 17v2M5 18H3" />
    </Svg>
  );
}

// A target of the lucide set, the field takes the goal instead of a request.
export function IconGoal(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  );
}

// A microphone of the lucide set, the request is spoken instead of typed.
export function IconMic(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M12 19v3" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <rect x="9" y="2" width="6" height="13" rx="3" />
    </Svg>
  );
}

// A paperclip, it attaches files to the request.
export function IconAttach(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  );
}

// A chevron, it opens a menu.
export function IconCaret(): ReactNode {
  return (
    <Svg>
      <path d={CARET_PATH} />
    </Svg>
  );
}

// A cross of the lucide set, it opens a new chat.
export function IconPlus(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </Svg>
  );
}

// An x of the lucide set, it removes a chat or a chip.
export function IconClose(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
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

// Bars, the graph of the token spend.
export function IconGraph(): ReactNode {
  return (
    <Svg>
      <path d="M3 12.5h10" />
      <path d="M5 10.5V7.5M8 10.5V4.5M11 10.5V8.5" />
    </Svg>
  );
}

// A page, the agent reads a file.
export function IconRead(): ReactNode {
  return (
    <Svg>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
      <path d="M6 8.5h4M6 11h3" />
    </Svg>
  );
}

// A page with a pencil, the agent creates a file.
export function IconWrite(): ReactNode {
  return (
    <Svg>
      <path d="M4 2.5h5l3 3v8H4z" />
      <path d="M9 2.5v3h3" />
      <path d="M6 11.2l.4-1.7 2.6-2.6 1.3 1.3-2.6 2.6z" />
    </Svg>
  );
}

// A pencil, the agent changes a file.
export function IconEdit(): ReactNode {
  return (
    <Svg>
      <path d="M11.2 2.9 13.1 4.8l-6.6 6.6-2.6.7.7-2.6z" />
      <path d="M9.9 4.2 11.8 6.1" />
    </Svg>
  );
}

// A magnifier, the agent searches the code.
export function IconSearch(): ReactNode {
  return (
    <Svg>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </Svg>
  );
}

// Lines, the agent lists the files.
export function IconList(): ReactNode {
  return (
    <Svg>
      <path d="M6.5 4.5h6.5M6.5 8h6.5M6.5 11.5h6.5" />
      <path d="M3.5 4.5h.01M3.5 8h.01M3.5 11.5h.01" />
    </Svg>
  );
}

// A terminal, the agent runs a command.
export function IconTerminal(): ReactNode {
  return (
    <Svg>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M5 7l2 1.5L5 10M8.5 10.5H11" />
    </Svg>
  );
}

// A clock, the list of the saved chats.
export function IconHistory(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </Svg>
  );
}

// A branch of git, the tools of the repository.
export function IconGit(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M6 3v12" />
      <path d="M18 3a3 3 0 1 0 0 6a3 3 0 1 0 0-6" />
      <path d="M6 15a3 3 0 1 0 0 6a3 3 0 1 0 0-6" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Svg>
  );
}

// An arrow that turns back, the request runs again.
export function IconRetry(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

// The arrow that takes the chat back to a request. It points at the
// message it belongs to, so it stands on the left of the words. The
// shape comes from the drawing of the reader: a loop on the left and
// the nose to the right. It sits on the lucide grid with the inset, the
// line and the size of its neighbours: the first drawing ran to the edge
// of the box with a thinner line and 16 pixels, and looked louder.
export function IconRewind(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d="M19 20H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h13" />
      <path d="m16 4 4 4-4 4" />
    </Svg>
  );
}

// Two sheets, the copy button.
export function IconCopy(): ReactNode {
  return (
    <Svg>
      <rect {...COPY_RECT} />
      <path d={COPY_PATH} />
    </Svg>
  );
}

// A check of the lucide set, it confirms a copy.
export function IconCheck(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={2}>
      <path d={CHECK_PATH} />
    </Svg>
  );
}

// The arrow of the codicon set of VS Code, the glyph "send". The codicons
// are contours of a font, so the arrow is filled, not stroked. It keeps the
// size of the paperclip, both stand in the same field of the prompt.
export function IconSend(): ReactNode {
  return (
    <Svg filled>
      <path d={CODICON_SEND} />
    </Svg>
  );
}

// The square of the codicon set of VS Code, the glyph "debug-stop". It
// stops the current turn and holds the size of the arrow above.
export function IconStop(): ReactNode {
  return (
    <Svg filled>
      <path d={CODICON_DEBUG_STOP} />
    </Svg>
  );
}
