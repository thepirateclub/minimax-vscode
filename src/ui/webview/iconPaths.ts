// The geometry of the icons that are drawn both by React and by the html of
// the markdown. One path keeps an icon of a card and of a code block alike.
// The grid is the grid of lucide with 24 units and a line of 2 units, the
// same as every other icon of the panel.
export const CARET_PATH = 'm6 9 6 6 6-6';
export const COPY_RECT = { x: 8, y: 8, width: 14, height: 14, rx: 2 };
export const COPY_PATH = 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2';
// The check of the lucide set, it confirms a copy.
export const CHECK_PATH = 'M20 6 9 17l-5-5';

function svg(viewBox: string, strokeWidth: number, className: string, body: string): string {
  return (
    '<svg class="icon ' +
    className +
    '" width="14" height="14" viewBox="' +
    viewBox +
    '" fill="none" stroke="currentColor" stroke-width="' +
    strokeWidth +
    '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    body +
    '</svg>'
  );
}

// The icons as html strings, the markdown renders html, not React.
export const CARET_SVG = svg('0 0 24 24', 2, 'icon-caret', '<path d="' + CARET_PATH + '"/>');
export const COPY_SVG = svg(
  '0 0 24 24',
  2,
  'icon-copy',
  '<rect x="' +
    COPY_RECT.x +
    '" y="' +
    COPY_RECT.y +
    '" width="' +
    COPY_RECT.width +
    '" height="' +
    COPY_RECT.height +
    '" rx="' +
    COPY_RECT.rx +
    '"/><path d="' +
    COPY_PATH +
    '"/>'
);
export const CHECK_SVG = svg('0 0 24 24', 2, 'icon-check', '<path d="' + CHECK_PATH + '"/>');
