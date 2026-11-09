import MarkdownIt from 'markdown-it';
import { highlight } from './highlight';

// The same text is rendered again when the panel is reopened, the cache keeps
// the stream cheap. The limit stops the cache from growing with the chat.
const CACHE_LIMIT = 64;
const cache = new Map<string, string>();

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false
});

// A code block gets a header with the language and a copy button.
md.renderer.rules.fence = (tokens, idx): string => {
  const token = tokens[idx]!;
  const info = token.info.trim();
  const language = info.split(/\s+/)[0] ?? '';
  const code = highlight(token.content, language);
  return (
    '<div class="code-block">' +
    '<div class="code-head">' +
    '<span class="code-lang">' +
    md.utils.escapeHtml(language) +
    '</span>' +
    '<button type="button" class="code-copy">Copy</button>' +
    '</div>' +
    '<pre><code>' +
    code +
    '</code></pre>' +
    '</div>'
  );
};

// A checklist item keeps its box, the model writes them often.
md.core.ruler.push('task_items', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.type !== 'inline') {
      continue;
    }
    // The inline token of a list item sits behind the paragraph, the item
    // itself is the token before it.
    let index = i - 1;
    while (
      index >= 0 &&
      (tokens[index]!.type === 'paragraph_open' || tokens[index]!.type === 'hidden')
    ) {
      index -= 1;
    }
    if (index < 0 || tokens[index]!.type !== 'list_item_open') {
      continue;
    }
    const match = /^\[([ xX])\]\s+/.exec(token.content);
    if (!match) {
      continue;
    }
    token.content = token.content.slice(match[0].length);
    const item = tokens[index]!;
    item.attrSet('class', 'task-item');
    if (match[1]?.toLowerCase() === 'x') {
      item.attrSet('data-checked', 'true');
    }
  }
  return true;
});

// The tag of a list item comes from the generic token renderer, the rule
// of the opening token puts the checkbox of a checklist in front of the text.
md.renderer.rules.list_item_open = (tokens, idx, options, _env, self): string => {
  const token = tokens[idx]!;
  const html = self.renderToken(tokens, idx, options);
  if (token.attrGet('class') !== 'task-item') {
    return html;
  }
  const checked = token.attrGet('data-checked') === 'true';
  const box =
    '<input class="task-check" type="checkbox" disabled' + (checked ? ' checked' : '') + '> ';
  return html.replace(/^<li([^>]*)>/, '<li$1>' + box);
};

export function renderMarkdown(text: string): string {
  const cached = cache.get(text);
  if (cached !== undefined) {
    return cached;
  }
  const html = md.render(text);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(text, html);
  return html;
}
