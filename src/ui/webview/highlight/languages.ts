// The languages of the highlighter: the words of every language and the
// table of the specs.
export function words(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((word) => word.length > 0));
}

export interface CodeSpec {
  mode: 'code';
  lineComments: string[];
  blockComments: Array<[string, string]>;
  strings: string[];
  tripleStrings: string[];
  keywords: Set<string>;
  types: Set<string>;
}

export type SimpleMode = 'markup' | 'json' | 'css' | 'yaml' | 'markdown' | 'diff' | 'plain';

export type LanguageSpec = CodeSpec | { mode: SimpleMode };

export const TS_KEYWORDS = words(
  'const let var function return if else for while do break continue switch case default ' +
    'try catch finally throw new delete typeof instanceof in of class extends implements ' +
    'interface type enum import export from as async await yield super this void null ' +
    'undefined true false readonly public private protected static abstract get set keyof ' +
    'satisfies is declare namespace module require'
);

export const TS_TYPES = words(
  'string number boolean any unknown never void object symbol bigint Array Promise Record ' +
    'Partial Readonly Map Set Error Date RegExp'
);

export const PYTHON_KEYWORDS = words(
  'def class return if elif else for while break continue pass import from as try except ' +
    'finally raise with lambda yield global nonlocal assert del async await match case and ' +
    'or not in is None True False self cls'
);

export const PYTHON_TYPES = words(
  'str int float bool list dict set tuple bytes object Exception'
);

export const JAVA_KEYWORDS = words(
  'public private protected class interface enum record extends implements new return if else ' +
    'for while do switch case default break continue try catch finally throw throws static ' +
    'final abstract synchronized volatile transient instanceof this super import package ' +
    'null true false var sealed permits yield'
);

export const JAVA_TYPES = words(
  'String Integer Long Double Float Boolean Object List Map Set Exception'
);

export const GO_KEYWORDS = words(
  'package import func return if else for range switch case default break continue goto ' +
    'defer go chan select struct interface map type const var nil true false fallthrough'
);

export const GO_TYPES = words(
  'string int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 bool ' +
    'byte rune error any'
);

export const RUST_KEYWORDS = words(
  'fn let mut const static struct enum impl trait for while loop if else match return use ' +
    'mod pub crate self Self where async await move ref dyn type unsafe true false Some None ' +
    'Ok Err'
);

export const RUST_TYPES = words(
  'str String Vec Option Result Box i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 bool char'
);

export const C_KEYWORDS = words(
  'auto break case char const continue default do double else enum extern float for goto if ' +
    'inline int long register restrict return short signed sizeof static struct switch ' +
    'typedef union unsigned void volatile while bool class namespace template public private ' +
    'protected virtual new delete this operator using try catch throw nullptr true false'
);

export const CSHARP_KEYWORDS = words(
  'abstract as base bool break byte case catch char checked class const continue decimal ' +
    'default delegate do double else enum event explicit extern false finally fixed float for ' +
    'foreach goto if implicit in int interface internal is lock long namespace new null object ' +
    'operator out override params private protected public readonly ref return sbyte sealed ' +
    'short sizeof stackalloc static string struct switch this throw true try typeof uint ulong ' +
    'unchecked unsafe ushort using var virtual void volatile while async await record'
);

export const PHP_KEYWORDS = words(
  'abstract and array as break callable case catch class clone const continue declare default ' +
    'do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends ' +
    'final finally fn for foreach function global goto if implements include include_once ' +
    'instanceof insteadof interface isset list namespace new or print private protected public ' +
    'readonly require require_once return static switch throw trait try unset use var while ' +
    'xor yield match enum'
);

export const SWIFT_KEYWORDS = words(
  'associatedtype class deinit enum extension fileprivate func import init inout internal let ' +
    'open operator private protocol public rethrows static struct subscript typealias var ' +
    'break case continue default defer do else fallthrough for guard if in repeat return ' +
    'switch where while as catch false is nil super self Self throw throws true try'
);

export const KOTLIN_KEYWORDS = words(
  'as break by catch class companion const constructor continue crossinline data do else enum ' +
    'external false final finally for fun get if import in infix init inline inner interface ' +
    'internal is lateinit noinline null object open operator out override package private ' +
    'protected public reified return sealed set super suspend this throw true try typealias ' +
    'typeof val var vararg when while'
);

export const SCALA_KEYWORDS = words(
  'abstract case catch class def do else extends false final finally for forSome if implicit ' +
    'import lazy match new null object override package private protected return sealed super ' +
    'this throw trait try true type val var while with yield'
);

export const SQL_KEYWORDS = words(
  'select from where join left right inner outer full on group by order having limit offset ' +
    'insert into values update set delete create table alter drop index view as and or not null ' +
    'is in between like ilike distinct count sum avg min max case when then else end union all ' +
    'primary key foreign references default with returning exists'
);

export const SHELL_KEYWORDS = words(
  'if then else elif fi for while until do done case esac function return export local ' +
    'readonly declare source echo cd exit set unset shift trap eval exec printf read test ' +
    'sudo apt npm npx node yarn pnpm git docker kubectl curl wget python pip make chmod chown ' +
    'mkdir rm cp mv ls grep sed awk cat tar'
);

export const POWERSHELL_KEYWORDS = words(
  'function param if else elseif switch foreach for while do until return break continue try ' +
    'catch finally throw begin process end class filter using import export new in not and or ' +
    'xor true false null write-host write-output write-error get-childitem get-content ' +
    'set-content remove-item new-item test-path invoke-webrequest invoke-restmethod ' +
    'select-object where-object foreach-object'
);

export function code(
  lineComments: string[],
  blockComments: Array<[string, string]>,
  strings: string[],
  keywords: Set<string>,
  types: Set<string>,
  tripleStrings: string[] = []
): CodeSpec {
  return { mode: 'code', lineComments, blockComments, strings, tripleStrings, keywords, types };
}

export const SPECS: Record<string, LanguageSpec> = {};

export function register(aliases: string[], spec: LanguageSpec): void {
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

export function normalize(language: string): string {
  return language.trim().toLowerCase().replace(/^\./, '');
}

export function supportsLanguage(language: string): boolean {
  return SPECS[normalize(language)] !== undefined;
}
