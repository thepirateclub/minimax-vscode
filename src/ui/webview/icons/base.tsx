// Inline SVG icons, the panel inherits the theme colors from the host.
// Every icon of the panel is one family: the grid of lucide with 24 units,
// a line of 2 units and 14 pixels on the screen. A hand drawn icon looked
// thinner, a 16 pixel one looked louder.
import type { ReactNode } from 'react';

export interface IconProps {
  size?: number;
}

export function Svg({
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
