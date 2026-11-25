// The page is read as text: the words of the page stay, the markup of the page
// goes away. The extension carries no html parser, the tags are read by
// hand: a page is a text with a few known shapes.

// The elements that go away with their content: the scripts, the styles, the
// navigation and the service parts of the site.
const DROPPED = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'canvas',
  'iframe',
  'object',
  'embed',
  'nav',
  'aside',
  'form',
  'select',
  'button',
  'head',
  'audio',
  'video',
  'picture',
  'map'
];

// The elements that open a paragraph of the text.
const PARAGRAPH = [
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'blockquote',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'ul',
  'ol',
  'dl',
  'dd',
  'dt',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'address',
  'details',
  'summary',
  'fieldset',
  'legend',
  'caption',
  'center',
  'html',
  'body'
];

// The elements that end a line of the text.
const LINE = ['br', 'hr', 'li', 'td', 'th', 'option'];

// The entities of a page that the model reads as the words they stand for.
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  shy: '',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  middot: '\u00b7',
  deg: '\u00b0',
  plusmn: '\u00b1',
  times: '\u00d7',
  divide: '\u00f7',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  micro: '\u00b5',
  para: '\u00b6',
  sect: '\u00a7',
  dagger: '\u2020',
  permil: '\u2030',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  curren: '\u00a4',
  iexcl: '\u00a1',
  iquest: '\u00bf',
  szlig: '\u00df',
  auml: '\u00e4',
  ouml: '\u00f6',
  uuml: '\u00fc',
  Auml: '\u00c4',
  Ouml: '\u00d6',
  Uuml: '\u00dc',
  eacute: '\u00e9',
  egrave: '\u00e8',
  agrave: '\u00e0',
  acirc: '\u00e2',
  ccedil: '\u00e7',
  ntilde: '\u00f1'
};

// The mark of a block of code, it is put back after the text is cleaned.
const PRE_MARK = '\u0001pre';

export interface PageText {
  // The title of the page, it comes apart from the text of it.
  title: string;
  text: string;
}

// The words behind the entities of a page: the model reads &amp; as & and
// not as the name of the entity.
export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi,
    (whole: string, name: string): string => {
      if (name.startsWith('#')) {
        const hex = name[1] === 'x' || name[1] === 'X';
        const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
          return whole;
        }
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      const named = ENTITIES[name.toLowerCase()];
      return named ?? whole;
    }
  );
}

// The tags of the page go away, the words between them stay.
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, '');
}

// The spaces of a line become one, the empty lines of the page become one
// empty line: a wall of blank lines is noise for the model.
function collapse(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// The readable text of a page: the words of it, the title of it apart.
export function htmlToText(html: string): PageText {
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  // The title is read before the head of the page goes away.
  const found = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  const title = found ? collapse(decodeEntities(stripTags(found[1] ?? ''))) : '';

  // The code of the page keeps its spaces, it is put back after the text.
  const blocks: string[] = [];
  body = body.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_whole: string, code: string): string => {
    const text = decodeEntities(stripTags(code ?? ''))
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+$/gm, '');
    blocks.push(text);
    return '\n' + PRE_MARK + (blocks.length - 1) + '\n';
  });

  for (const tag of DROPPED) {
    body = body.replace(
      new RegExp('<' + tag + '(?:\\s[^>]*)?>[\\s\\S]*?<\\/' + tag + '>', 'gi'),
      ' '
    );
  }
  body = body.replace(
    new RegExp('<\\/?(?:' + PARAGRAPH.join('|') + ')\\b[^>]*>', 'gi'),
    '\n'
  );
  body = body.replace(new RegExp('<\\/?(?:' + LINE.join('|') + ')\\b[^>]*>', 'gi'), '\n');
  body = stripTags(body);
  body = decodeEntities(body);

  let text = collapse(body);
  text = text.replace(
    new RegExp(PRE_MARK + '(\\d+)', 'g'),
    (_whole: string, index: string): string => blocks[Number(index)] ?? ''
  );
  return { title, text: text.trim() };
}
