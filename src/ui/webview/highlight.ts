// Syntax highlighting for the code blocks of the answer. The webview cannot
// ask the host for the token colors of the theme, so every token gets a class
// and the palette lives in the css.
export { highlight } from './highlight/lexer';
export { escapeHtml } from './highlight/tokens';
export { supportsLanguage } from './highlight/languages';
export type { Token, TokenKind } from './highlight/tokens';
