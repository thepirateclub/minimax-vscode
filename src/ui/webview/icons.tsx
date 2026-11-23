// Inline SVG icons, the panel inherits the theme colors from the host.
// Every icon of the panel is one family: the grid of lucide with 24 units,
// a line of 2 units and 14 pixels on the screen. A hand drawn icon looked
// thinner, a 16 pixel one looked louder.
import type { ReactNode } from 'react';
import { CARET_PATH, CHECK_PATH, COPY_PATH, COPY_RECT } from './iconPaths';

interface IconProps {
  size?: number;
}

function Svg({
  size = 14,
  viewBox = '0 0 24 24',
  strokeWidth = 2,
  children
}: IconProps & {
  viewBox?: string;
  strokeWidth?: number;
  children: ReactNode;
}): ReactNode {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
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
export function IconRead(): ReactNode {
  // lucide "file-text"
  return (
    <Svg>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </Svg>
  );
}

// A page with a plus, the agent creates a file.
export function IconWrite(): ReactNode {
  // lucide "file-plus"
  return (
    <Svg>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M9 15h6" />
      <path d="M12 12v6" />
    </Svg>
  );
}

// A pencil, the agent changes a file.
export function IconEdit(): ReactNode {
  // lucide "pencil"
  return (
    <Svg>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </Svg>
  );
}

// A magnifier, the agent searches the code.
export function IconSearch(): ReactNode {
  // lucide "search"
  return (
    <Svg>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  );
}

// Lines with dots, the agent lists the files.
export function IconList(): ReactNode {
  // lucide "list"
  return (
    <Svg>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </Svg>
  );
}

// A terminal, the agent runs a command.
export function IconTerminal(): ReactNode {
  // lucide "terminal"
  return (
    <Svg>
      <path d="m4 17 6-6-6-6" />
      <path d="M12 19h8" />
    </Svg>
  );
}

// A clock with an arrow, the list of the saved chats.
export function IconHistory(): ReactNode {
  // lucide "history"
  return (
    <Svg>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </Svg>
  );
}

// A branch of git, the tools of the repository.
export function IconGit(): ReactNode {
  // lucide "git-branch"
  return (
    <Svg>
      <path d="M6 3v12" />
      <path d="M18 3a3 3 0 1 0 0 6a3 3 0 0 0 0-6" />
      <path d="M6 15a3 3 0 1 0 0 6a3 3 0 0 0 0-6" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </Svg>
  );
}

// An arrow that turns back, the request runs again.
export function IconRetry(): ReactNode {
  // lucide "rotate-ccw"
  return (
    <Svg>
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
    <Svg>
      <path d="M19 20H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3h13" />
      <path d="m16 4 4 4-4 4" />
    </Svg>
  );
}

// Two sheets, the copy button.
export function IconCopy(): ReactNode {
  // lucide "copy"
  return (
    <Svg>
      <rect {...COPY_RECT} />
      <path d={COPY_PATH} />
    </Svg>
  );
}

// A check of the lucide set, it confirms a copy.
export function IconCheck(): ReactNode {
  // lucide "check"
  return (
    <Svg>
      <path d={CHECK_PATH} />
    </Svg>
  );
}

// Two arrows in a circle, the request goes out again after the loss of the
// connection.
export function IconRefresh(): ReactNode {
  // lucide "refresh-cw"
  return (
    <Svg>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </Svg>
  );
}

// A folder, the chat belongs to the project of the folder.
export function IconFolder(): ReactNode {
  // lucide "folder"
  return (
    <Svg>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Svg>
  );
}

// Sheets on top of each other, the chats of every project.
export function IconLayers(): ReactNode {
  // lucide "layers"
  return (
    <Svg>
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </Svg>
  );
}

// A clock, the message of the queue waits.
export function IconClock(): ReactNode {
  // lucide "clock"
  return (
    <Svg>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </Svg>
  );
}

// A triangle with a mark, the message of the queue failed.
export function IconAlert(): ReactNode {
  // lucide "alert-triangle"
  return (
    <Svg>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </Svg>
  );
}

// The arrow of the lucide set, the request goes out.
export function IconSend(): ReactNode {
  // lucide "arrow-up"
  return (
    <Svg>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </Svg>
  );
}

// The square of the lucide set, the turn stops.
export function IconStop(): ReactNode {
  // lucide "square"
  return (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="2" />
    </Svg>
  );
}

// The priority of a task is an arrow of jira: the low one points down, the
// medium and the high ones point up, the very high is a double arrow.
export function IconPriorityLow(): ReactNode {
  // lucide "chevron-down"
  return (
    <Svg>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function IconPriorityMedium(): ReactNode {
  // lucide "chevron-up"
  return (
    <Svg>
      <path d="m18 15-6-6-6 6" />
    </Svg>
  );
}

export function IconPriorityHigh(): ReactNode {
  // lucide "chevron-up"
  return (
    <Svg>
      <path d="m18 15-6-6-6 6" />
    </Svg>
  );
}

// Two arrows of jira, the highest priority of the issue.
export function IconPriorityVeryHigh(): ReactNode {
  return (
    <Svg>
      <path d="m7 12 5-5 5 5" />
      <path d="m7 17 5-5 5 5" />
    </Svg>
  );
}
