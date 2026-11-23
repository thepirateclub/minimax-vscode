import type { ReactNode } from 'react';
import { CHECK_PATH, COPY_PATH, COPY_RECT } from '../iconPaths';
import { Svg } from './base';

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
