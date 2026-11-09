// Inline SVG icons, the panel inherits the theme colors from the host.
import type { ReactNode } from 'react';

interface IconProps {
  size?: number;
}

function Svg({
  size = 14,
  viewBox = '0 0 16 16',
  strokeWidth = 1.4,
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
  return (
    <Svg>
      <path d="M4.5 5.5h2M4.5 8.5h2M4.5 11.5h2" />
      <path d="M8.5 5.5h3M8.5 8.5h3M8.5 11.5h3" />
    </Svg>
  );
}

// Angle brackets, the agent edits files in code mode.
export function IconCode(): ReactNode {
  return (
    <Svg>
      <path d="M6 4.5 3 8l3 3.5" />
      <path d="M10 4.5 13 8l-3 3.5" />
    </Svg>
  );
}

// A chip, the model runs on the server.
export function IconModel(): ReactNode {
  return (
    <Svg>
      <rect x="5" y="5" width="6" height="6" rx="1" />
      <path d="M7 5V3M9 5V3M7 13v-2M9 13v-2M5 7H3M5 9H3M13 7h-2M13 9h-2" />
    </Svg>
  );
}

// A spark, the model thinks before it answers.
export function IconThinking(): ReactNode {
  return (
    <Svg>
      <path d="M7.6 2.6 9 5.8l3.2 1.4L9 8.6l-1.4 3.2L6.2 8.6 3 7.2 6.2 5.8z" />
      <path d="M12.2 9.4l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" />
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
      <path d="M4.5 6.5 8 10l3.5-3.5" />
    </Svg>
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

// Two sheets, the copy button.
export function IconCopy(): ReactNode {
  return (
    <Svg>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M10.5 5.5v-1a1.2 1.2 0 0 0-1.2-1.2H3.7A1.2 1.2 0 0 0 2.5 4.5v5.6a1.2 1.2 0 0 0 1.2 1.2h1.3" />
    </Svg>
  );
}

// The plane of the reference picture, traced pixel by pixel: a narrow
// dart with a right angle at the tip and a fold from the tip to the tail.
// The picture is the measure, the glyph is 15.4 pixels tall and the stroke
// is 1.5 pixels wide, so the button shows exactly that.
export function IconSend(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={1.9} size={19}>
      <path d="M4.84 2.16 L18.93 7.75 L13.34 21.84 L10.4 10.59 Z" />
      <path d="M10.4 10.59 L18.93 7.75" />
    </Svg>
  );
}

// A square, it stops the current turn. It keeps the weight of the plane
// above, so the button does not shrink when the turn starts.
export function IconStop(): ReactNode {
  return (
    <Svg viewBox="0 0 24 24" strokeWidth={1.9} size={19}>
      <rect x="4.75" y="4.75" width="14.5" height="14.5" rx="2" />
    </Svg>
  );
}
