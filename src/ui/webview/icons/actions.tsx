import type { ReactNode } from 'react';
import { Svg } from './base';

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

// An arrow into a tray, the chat is saved to a file.
export function IconDownload(): ReactNode {
  // lucide "download"
  return (
    <Svg>
      <path d="M12 15V3" />
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
    </Svg>
  );
}
