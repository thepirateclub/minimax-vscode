// The geometry of the icons that are drawn both by React and by the html of
// the markdown. One path keeps an icon of a card and of a code block alike.
export const CARET_PATH = 'M4.5 6.5 8 10l3.5-3.5';
export const COPY_RECT = { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.2 };
export const COPY_PATH =
  'M10.5 5.5v-1a1.2 1.2 0 0 0-1.2-1.2H3.7A1.2 1.2 0 0 0 2.5 4.5v5.6a1.2 1.2 0 0 0 1.2 1.2h1.3';
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
export const CARET_SVG = svg('0 0 16 16', 1.4, 'icon-caret', '<path d="' + CARET_PATH + '"/>');
export const COPY_SVG = svg(
  '0 0 16 16',
  1.4,
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
