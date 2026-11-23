import { normalize, SPECS, type LanguageSpec } from './languages';
import { escapeHtml, type Token } from './tokens';
import { tokenizeCode, tokenizeJson, tokenizeMarkup } from './tokenizers';
import { tokenizeCss, tokenizeDiff, tokenizeMarkdown, tokenizeYaml } from './tokenizersText';

export function tokenize(spec: LanguageSpec, codeText: string): Token[] {
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
