// The geometry of the icons that are drawn both by React and by the html of
// the markdown. One path keeps the chevron of a card and of a code block alike.
export const CARET_PATH = 'M4.5 6.5 8 10l3.5-3.5';

// The chevron as an html string, the markdown renders html, not React.
export const CARET_SVG =
  '<svg class="icon" width="14" height="14" viewBox="0 0 16 16" fill="none" ' +
  'stroke="currentColor" stroke-width="1.4" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true"><path d="' +
  CARET_PATH +
  '"/></svg>';
