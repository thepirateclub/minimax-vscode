// Syntax highlighting for the code blocks of the answer. The webview cannot
// ask the host for the token colors of the theme, so every token gets a class
// and the palette lives in the css.

export type TokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'type'
  | 'function'
  | 'variable'
  | 'operator'
  | 'attribute'
  | 'property'
  | 'tag'
  | 'add'
  | 'remove'
  | 'plain';

export interface Token {
  kind: TokenKind;
  text: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

function words(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((word) => word.length > 0));
}

interface CodeSpec {
  mode: 'code';
  lineComments: string[];
  blockComments: Array<[string, string]>;
  strings: string[];
  tripleStrings: string[];
  keywords: Set<string>;
  types: Set<string>;
}

type SimpleMode = 'markup' | 'json' | 'css' | 'yaml' | 'markdown' | 'diff' | 'plain';

type LanguageSpec = CodeSpec | { mode: SimpleMode };

const TS_KEYWORDS = words(
  'const let var function return if else for while do break continue switch case default ' +
    'try catch finally throw new delete typeof instanceof in of class extends implements ' +
    'interface type enum import export from as async await yield super this void null ' +
    'undefined true false readonly public private protected static abstract get set keyof ' +
    'satisfies is declare namespace module require'
);

const TS_TYPES = words(
  'string number boolean any unknown never void object symbol bigint Array Promise Record ' +
    'Partial Readonly Map Set Error Date RegExp'
);

const PYTHON_KEYWORDS = words(
  'def class return if elif else for while break continue pass import from as try except ' +
    'finally raise with lambda yield global nonlocal assert del async await match case and ' +
    'or not in is None True False self cls'
);

const PYTHON_TYPES = words(
  'str int float bool list dict set tuple bytes object Exception'
);

const JAVA_KEYWORDS = words(
  'public private protected class interface enum record extends implements new return if else ' +
    'for while do switch case default break continue try catch finally throw throws static ' +
    'final abstract synchronized volatile transient instanceof this super import package ' +
    'null true false var sealed permits yield'
);

const JAVA_TYPES = words(
  'String Integer Long Double Float Boolean Object List Map Set Exception'
);

const GO_KEYWORDS = words(
  'package import func return if else for range switch case default break continue goto ' +
    'defer go chan select struct interface map type const var nil true false fallthrough'
);

const GO_TYPES = words(
  'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 bool ' +
    'byte rune error any'
);

const RUST_KEYWORDS = words(
  'fn let mut const static struct enum impl trait for while loop if else match return use ' +
    'mod pub crate self Self where async await move ref dyn type unsafe true false Some None ' +
    'Ok Err'
);

const RUST_TYPES = words(
  'str String Vec Option Result Box i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 bool char'
);

const C_KEYWORDS = words(
  'auto break case char const continue default do double else enum extern float for goto if ' +
    'inline int long register restrict return short signed sizeof static struct switch ' +
    'typedef union unsigned void volatile while bool class namespace template public private ' +
    'protected virtual new delete this operator using try catch throw nullptr true false'
);

const CSHARP_KEYWORDS = words(
  'abstract as base bool break byte case catch char checked class const continue decimal ' +
    'default delegate do double else enum event explicit extern false finally fixed float for ' +
    'foreach goto if implicit in int interface internal is lock long namespace new null object ' +
    'operator out override params private protected public readonly ref return sbyte sealed ' +
    'short sizeof stackalloc static string struct switch this throw true try typeof uint ulong ' +
    'unchecked unsafe ushort using var virtual void volatile while async await record'
);

const PHP_KEYWORDS = words(
  'abstract and array as break callable case catch class clone const continue declare default ' +
    'do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends ' +
    'final finally fn for foreach function global goto if implements include include_once ' +
    'instanceof insteadof interface isset list namespace new or print private protected public ' +
    'readonly require require_once return static switch throw trait try unset use var while ' +
    'xor yield match enum'
);

const SWIFT_KEYWORDS = words(
  'associatedtype class deinit enum extension fileprivate func import init inout internal let ' +
    'open operator private protocol public rethrows static struct subscript typealias var ' +
    'break case continue default defer do else fallthrough for guard if in repeat return ' +
    'switch where while as catch false is nil super self Self throw throws true try'
);

const KOTLIN_KEYWORDS = words(
  'as break by catch class companion const constructor continue crossinline data do else enum ' +
    'external false final finally for fun get if import in infix init inline inner interface ' +
    'internal is lateinit noinline null object open operator out override package private ' +
    'protected public reified return sealed set super suspend this throw true try typealias ' +
    'typeof val var vararg when while'
);

const SCALA_KEYWORDS = words(
  'abstract case catch class def do else extends false final finally for forSome if implicit ' +
    'import lazy match new null object override package private protected return sealed super ' +
    'this throw trait try true type val var while with yield'
);

const SQL_KEYWORDS = words(
  'select from where join left right inner outer full on group by order having limit offset ' +
    'insert into values update set delete create table alter drop index view as and or not null ' +
    'is in between like ilike distinct count sum avg min max case when then else end union all ' +
    'primary key foreign references default with returning exists'
);

const SHELL_KEYWORDS = words(
  'if then else elif fi for while until do done case esac function return export local ' +
    'readonly declare source echo cd exit set unset shift trap eval exec printf read test ' +
    'sudo apt npm npx node yarn pnpm git docker kubectl curl wget python pip make chmod chown ' +
    'mkdir rm cp mv ls grep sed awk cat tar'
);

const POWERSHELL_KEYWORDS = words(
  'function param if else elseif switch foreach for while do until return break continue try ' +
    'catch finally throw begin process end class filter using import export new in not and or ' +
    'xor true false null write-host write-output write-error get-childitem get-content ' +
    'set-content remove-item new-item test-path invoke-webrequest invoke-restmethod ' +
    'select-object where-object foreach-object'
);

function code(
  lineComments: string[],
  blockComments: Array<[string, string]>,
  strings: string[],
  keywords: Set<string>,
  types: Set<string>,
  tripleStrings: string[] = []
): CodeSpec {
  return { mode: 'code', lineComments, blockComments, strings, tripleStrings, keywords, types };
}

const SPECS: Record<string, LanguageSpec> = {};

function register(aliases: string[], spec: LanguageSpec): void {
  for (const alias of aliases) {
    SPECS[alias] = spec;
  }
}

register(
  ['ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx', 'mjs', 'cjs', 'vue', 'svelte'],
  code(['//'], [['/*', '*/']], ["'", '"', '`'], TS_KEYWORDS, TS_TYPES)
);
register(
  ['py', 'python'],
  code(['#'], [], ["'", '"'], PYTHON_KEYWORDS, PYTHON_TYPES, ['"""', "'''"])
);
register(['java'], code(['//'], [['/*', '*/']], ["'", '"'], JAVA_KEYWORDS, JAVA_TYPES));
register(
  ['kt', 'kotlin'],
  code(['//'], [['/*', '*/']], ["'", '"'], KOTLIN_KEYWORDS, words('String Int Long Double Boolean List Map Set Any'))
);
register(
  ['scala'],
  code(['//'], [['/*', '*/']], ["'", '"'], SCALA_KEYWORDS, words('String Int Long Double Boolean List Map Seq Option'))
);
register(['go', 'golang'], code(['//'], [['/*', '*/']], ["'", '"', '`'], GO_KEYWORDS, GO_TYPES));
register(['rs', 'rust'], code(['//'], [['/*', '*/']], ["'", '"'], RUST_KEYWORDS, RUST_TYPES));
register(
  ['c', 'cpp', 'c++', 'h', 'hpp', 'objc'],
  code(['//'], [['/*', '*/']], ["'", '"'], C_KEYWORDS, words('char int long short float double void'))
);
register(['cs', 'csharp', 'c#'], code(['//'], [['/*', '*/']], ["'", '"'], CSHARP_KEYWORDS, words('string int long double decimal bool object var')));
register(['php'], code(['//', '#'], [['/*', '*/']], ["'", '"'], PHP_KEYWORDS, words('string int float bool array object')));
register(['swift'], code(['//'], [['/*', '*/']], ["'", '"'], SWIFT_KEYWORDS, words('String Int Double Bool Array Dictionary')));
register(['dart'], code(['//'], [['/*', '*/']], ["'", '"'], SWIFT_KEYWORDS, words('String int double bool List Map')));
register(
  ['sh', 'bash', 'zsh', 'shell', 'console'],
  code(['#'], [], ["'", '"'], SHELL_KEYWORDS, words(''))
);
register(
  ['ps1', 'powershell', 'pwsh'],
  code(['#'], [['/*', '*/']], ["'", '"'], POWERSHELL_KEYWORDS, words(''))
);
register(['sql', 'mysql', 'postgres', 'sqlite'], code(['--'], [['/*', '*/']], ["'", '"'], SQL_KEYWORDS, words('')));
register(['json', 'jsonc', 'json5'], { mode: 'json' });
register(['html', 'xml', 'svg', 'xsl'], { mode: 'markup' });
register(['css', 'scss', 'sass', 'less'], { mode: 'css' });
register(['yaml', 'yml', 'toml', 'ini', 'conf'], { mode: 'yaml' });
register(['md', 'markdown'], { mode: 'markdown' });
register(['diff', 'patch'], { mode: 'diff' });
register(['txt', 'text', 'plain'], { mode: 'plain' });

function normalize(language: string): string {
  return language.trim().toLowerCase().replace(/^\./, '');
}

export function supportsLanguage(language: string): boolean {
  return SPECS[normalize(language)] !== undefined;
}

function push(tokens: Token[], kind: TokenKind, text: string): void {
  if (text.length === 0) {
    return;
  }
  const last = tokens[tokens.length - 1];
  if (last && last.kind === kind) {
    last.text += text;
    return;
  }
  tokens.push({ kind, text });
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function isUpperStart(word: string): boolean {
  const first = word.charAt(0);
  return first !== '' && first === first.toUpperCase() && first !== first.toLowerCase();
}

function skipSpace(codeText: string, index: number): number {
  let i = index;
  while (i < codeText.length && (codeText[i] === ' ' || codeText[i] === '\t')) {
    i += 1;
  }
  return i;
}

// The index after the closing quote, an unclosed string ends with the line.
function scanString(codeText: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    if (ch === '\n' && quote !== '`') {
      return i;
    }
    i += 1;
  }
  return codeText.length;
}

function scanNumber(codeText: string, start: number): number {
  let i = start;
  const first = codeText.charAt(i);
  if (first === '0' && /[xXbBoO]/.test(codeText.charAt(i + 1))) {
    i += 2;
    while (i < codeText.length && /[0-9a-fA-F_]/.test(codeText.charAt(i))) {
      i += 1;
    }
    return i;
  }
  while (i < codeText.length && (isDigit(codeText.charAt(i)) || codeText.charAt(i) === '_')) {
    i += 1;
  }
  if (codeText.charAt(i) === '.' && isDigit(codeText.charAt(i + 1))) {
    i += 1;
    while (i < codeText.length && (isDigit(codeText.charAt(i)) || codeText.charAt(i) === '_')) {
      i += 1;
    }
  }
  if (codeText.charAt(i) === 'e' || codeText.charAt(i) === 'E') {
    let j = i + 1;
    if (codeText.charAt(j) === '+' || codeText.charAt(j) === '-') {
      j += 1;
    }
    if (isDigit(codeText.charAt(j))) {
      i = j;
      while (i < codeText.length && isDigit(codeText.charAt(i))) {
        i += 1;
      }
    }
  }
  return i;
}

const OPERATORS = '+-*/%=<>!&|^~?:';

function tokenizeCode(codeText: string, spec: CodeSpec): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);

    let matched = false;
    for (const [open, close] of spec.blockComments) {
      if (codeText.startsWith(open, i)) {
        const end = codeText.indexOf(close, i + open.length);
        const stop = end === -1 ? codeText.length : end + close.length;
        push(tokens, 'comment', codeText.slice(i, stop));
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    for (const marker of spec.lineComments) {
      if (codeText.startsWith(marker, i)) {
        const end = codeText.indexOf('\n', i);
        const stop = end === -1 ? codeText.length : end;
        push(tokens, 'comment', codeText.slice(i, stop));
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    for (const quote of spec.tripleStrings) {
      if (codeText.startsWith(quote, i)) {
        const end = codeText.indexOf(quote, i + quote.length);
        const stop = end === -1 ? codeText.length : end + quote.length;
        push(tokens, 'string', codeText.slice(i, stop));
        i = stop;
        matched = true;
        break;
      }
    }
    if (matched) {
      continue;
    }

    if (spec.strings.includes(ch)) {
      const stop = scanString(codeText, i, ch);
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      continue;
    }

    const previous = i > 0 ? codeText.charAt(i - 1) : '';
    if (isDigit(ch) && !isWordChar(previous)) {
      const stop = scanNumber(codeText, i);
      push(tokens, 'number', codeText.slice(i, stop));
      i = stop;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i;
      while (j < codeText.length && isIdentPart(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const after = skipSpace(codeText, j);
      let kind: TokenKind = 'plain';
      if (spec.keywords.has(word.toLowerCase())) {
        kind = 'keyword';
      } else if (spec.types.has(word) || isUpperStart(word)) {
        kind = 'type';
      } else if (codeText.charAt(after) === '(') {
        kind = 'function';
      } else if (previous === '.') {
        kind = 'property';
      }
      push(tokens, kind, word);
      i = j;
      continue;
    }

    if (OPERATORS.includes(ch)) {
      push(tokens, 'operator', ch);
      i += 1;
      continue;
    }

    push(tokens, 'plain', ch);
    i += 1;
  }
  return tokens;
}

function tokenizeMarkup(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < codeText.length) {
    if (codeText.startsWith('<!--', i)) {
      const end = codeText.indexOf('-->', i);
      const stop = end === -1 ? codeText.length : end + 3;
      push(tokens, 'comment', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (codeText.charAt(i) === '<') {
      let j = i + 1;
      push(tokens, 'tag', '<');
      if (codeText.charAt(j) === '/') {
        push(tokens, 'tag', '/');
        j += 1;
      }
      let k = j;
      while (k < codeText.length && /[A-Za-z0-9:_-]/.test(codeText.charAt(k))) {
        k += 1;
      }
      push(tokens, 'tag', codeText.slice(j, k));
      j = k;
      while (j < codeText.length && codeText.charAt(j) !== '>') {
        const c = codeText.charAt(j);
        if (/\s/.test(c)) {
          push(tokens, 'plain', c);
          j += 1;
          continue;
        }
        if (c === '=') {
          push(tokens, 'plain', c);
          j += 1;
          continue;
        }
        if (c === '"' || c === "'") {
          const stop = scanString(codeText, j, c);
          push(tokens, 'string', codeText.slice(j, stop));
          j = stop;
          continue;
        }
        let m = j;
        while (m < codeText.length && /[A-Za-z0-9:_-]/.test(codeText.charAt(m))) {
          m += 1;
        }
        if (m === j) {
          push(tokens, 'plain', c);
          j += 1;
          continue;
        }
        push(tokens, 'attribute', codeText.slice(j, m));
        j = m;
      }
      if (j < codeText.length) {
        push(tokens, 'tag', '>');
        j += 1;
      }
      i = j;
      continue;
    }
    const next = codeText.indexOf('<', i);
    const stop = next === -1 ? codeText.length : next;
    push(tokens, 'plain', codeText.slice(i, stop));
    i = stop;
  }
  return tokens;
}

function tokenizeJson(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '"') {
      const stop = scanString(codeText, i, ch);
      const after = skipSpace(codeText, stop);
      const kind: TokenKind = codeText.charAt(after) === ':' ? 'attribute' : 'string';
      push(tokens, kind, codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (isDigit(ch) || (ch === '-' && isDigit(codeText.charAt(i + 1)))) {
      const stop = scanNumber(codeText, i);
      push(tokens, 'number', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (/[A-Za-z]/.test(ch)) {
      let j = i;
      while (j < codeText.length && /[A-Za-z0-9_]/.test(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const lower = word.toLowerCase();
      const kind: TokenKind =
        lower === 'true' || lower === 'false' || lower === 'null' ? 'keyword' : 'plain';
      push(tokens, kind, word);
      i = j;
      continue;
    }
    push(tokens, 'plain', ch);
    i += 1;
  }
  return tokens;
}

function tokenizeCss(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let inBlock = false;
  let expectProperty = false;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (codeText.startsWith('/*', i)) {
      const end = codeText.indexOf('*/', i + 2);
      const stop = end === -1 ? codeText.length : end + 2;
      push(tokens, 'comment', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const stop = scanString(codeText, i, ch);
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '@') {
      let j = i + 1;
      while (j < codeText.length && /[A-Za-z-]/.test(codeText.charAt(j))) {
        j += 1;
      }
      push(tokens, 'keyword', codeText.slice(i, j));
      i = j;
      continue;
    }
    if (ch === '{') {
      inBlock = true;
      expectProperty = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === '}') {
      inBlock = false;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === ':' && inBlock) {
      expectProperty = false;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === ';') {
      expectProperty = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (isDigit(ch)) {
      const stop = scanNumber(codeText, i);
      push(tokens, 'number', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i;
      while (j < codeText.length && /[A-Za-z0-9_-]/.test(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const after = skipSpace(codeText, j);
      if (inBlock && expectProperty) {
        push(tokens, 'property', word);
      } else if (codeText.charAt(after) === '(') {
        push(tokens, 'function', word);
      } else {
        push(tokens, 'plain', word);
      }
      i = j;
      continue;
    }
    push(tokens, 'plain', ch);
    i += 1;
  }
  return tokens;
}

function tokenizeYaml(codeText: string): Token[] {
  const tokens: Token[] = [];
  const literals = ['true', 'false', 'null', 'yes', 'no', 'on', 'off'];
  let i = 0;
  let atLineStart = true;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '\n') {
      atLineStart = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (ch === '#') {
      const end = codeText.indexOf('\n', i);
      const stop = end === -1 ? codeText.length : end;
      push(tokens, 'comment', codeText.slice(i, stop));
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const stop = scanString(codeText, i, ch);
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      atLineStart = false;
      continue;
    }
    if (atLineStart && (ch === '-' || ch === '?')) {
      push(tokens, 'operator', ch);
      i += 1;
      continue;
    }
    if (/[A-Za-z0-9_.\-/]/.test(ch)) {
      let j = i;
      while (j < codeText.length && /[A-Za-z0-9_.\-/]/.test(codeText.charAt(j))) {
        j += 1;
      }
      const word = codeText.slice(i, j);
      const after = skipSpace(codeText, j);
      if (codeText.charAt(after) === ':' || codeText.charAt(after) === '=') {
        push(tokens, 'attribute', word);
      } else if (/^[0-9.]+$/.test(word)) {
        push(tokens, 'number', word);
      } else if (literals.includes(word.toLowerCase())) {
        push(tokens, 'keyword', word);
      } else {
        push(tokens, 'plain', word);
      }
      i = j;
      atLineStart = false;
      continue;
    }
    push(tokens, 'plain', ch);
    i += 1;
    atLineStart = false;
  }
  return tokens;
}

function tokenizeMarkdown(codeText: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let atLineStart = true;
  while (i < codeText.length) {
    const ch = codeText.charAt(i);
    if (ch === '\n') {
      atLineStart = true;
      push(tokens, 'plain', ch);
      i += 1;
      continue;
    }
    if (atLineStart && ch === '#') {
      let j = i;
      while (j < codeText.length && codeText.charAt(j) === '#') {
        j += 1;
      }
      push(tokens, 'keyword', codeText.slice(i, j));
      i = j;
      atLineStart = false;
      continue;
    }
    if (atLineStart && codeText.startsWith('```', i)) {
      const end = codeText.indexOf('\n', i);
      const stop = end === -1 ? codeText.length : end;
      push(tokens, 'operator', codeText.slice(i, stop));
      i = stop;
      atLineStart = false;
      continue;
    }
    if (ch === '`') {
      const end = codeText.indexOf('`', i + 1);
      const stop = end === -1 ? codeText.length : end + 1;
      push(tokens, 'string', codeText.slice(i, stop));
      i = stop;
      atLineStart = false;
      continue;
    }
    if (ch === '[') {
      const close = codeText.indexOf(']', i);
      if (close !== -1 && codeText.charAt(close + 1) === '(') {
        const urlEnd = codeText.indexOf(')', close + 2);
        const stop = urlEnd === -1 ? codeText.length : urlEnd + 1;
        push(tokens, 'variable', codeText.slice(i, close + 1));
        push(tokens, 'string', codeText.slice(close + 1, stop));
        i = stop;
        atLineStart = false;
        continue;
      }
    }
    push(tokens, 'plain', ch);
    i += 1;
    atLineStart = false;
  }
  return tokens;
}

function tokenizeDiff(codeText: string): Token[] {
  const tokens: Token[] = [];
  const lines = codeText.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (index > 0) {
      push(tokens, 'plain', '\n');
    }
    if (line.startsWith('@@')) {
      push(tokens, 'comment', line);
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      push(tokens, 'type', line);
    } else if (line.startsWith('+')) {
      push(tokens, 'add', line);
    } else if (line.startsWith('-')) {
      push(tokens, 'remove', line);
    } else {
      push(tokens, 'plain', line);
    }
  }
  return tokens;
}

function tokenize(spec: LanguageSpec, codeText: string): Token[] {
  if (spec.mode === 'code') {
    return tokenizeCode(codeText, spec);
  }
  if (spec.mode === 'markup') {
    return tokenizeMarkup(codeText);
  }
  if (spec.mode === 'json') {
    return tokenizeJson(codeText);
  }
  if (spec.mode === 'css') {
    return tokenizeCss(codeText);
  }
  if (spec.mode === 'yaml') {
    return tokenizeYaml(codeText);
  }
  if (spec.mode === 'markdown') {
    return tokenizeMarkdown(codeText);
  }
  if (spec.mode === 'diff') {
    return tokenizeDiff(codeText);
  }
  return [{ kind: 'plain', text: codeText }];
}

// The code of a block with the tokens marked, an unknown language stays plain.
export function highlight(codeText: string, language: string): string {
  const spec = SPECS[normalize(language)];
  if (!spec) {
    return escapeHtml(codeText);
  }
  const tokens = tokenize(spec, codeText);
  let html = '';
  for (const token of tokens) {
    if (token.kind === 'plain') {
      html += escapeHtml(token.text);
      continue;
    }
    html += '<span class="tok-' + token.kind + '">' + escapeHtml(token.text) + '</span>';
  }
  return html;
}
