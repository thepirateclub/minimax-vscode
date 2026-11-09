import MarkdownIt from 'markdown-it';
import { describeCodeBlock, type CodeSource } from './codeBlock';
import { highlight } from './highlight';

// The same text is rendered again when the panel is reopened, the cache keeps
// the stream cheap. The limit stops the cache from growing with the chat.
const CACHE_LIMIT = 64;
const cache = new Map<string, string>();

// The sources of the snippets travel with the text, the renderer needs
// them to find the file of a block.
interface MarkdownEnv {
  sources?: CodeSource[];
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: false
});

// A code block gets a header with the language and a copy button. A snippet
// of a file shows the name of the file instead, the click opens the file.
md.renderer.rules.fence = (tokens, idx, _options, env): string => {
  const token = tokens[idx]!;
  const sources = (env as MarkdownEnv | undefined)?.sources;
  const block = describeCodeBlock(token.info, { content: token.content, sources });
  const code = highlight(token.content, block.language);
  const label = block.file
    ? '<button type="button" class="code-lang code-file" data-path="' +
      md.utils.escapeHtml(block.file) +
      '" data-line="' +
      block.line +
      '" title="' +
      md.utils.escapeHtml(block.file) +
      '">' +
      md.utils.escapeHtml(block.title) +
      '</button>'
    : '<span class="code-lang">' +
      md.utils.escapeHtml(block.title) +
      '</span>';
  return (
    '<div class="code-block">' +
    '<div class="code-head">' +
    label +
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

// The sources are part of the key, the same text can get the name of a
// file when the agent reads the file of the snippet.
function sourceSignature(sources: CodeSource[]): string {
  return sources.map((source) => source.path + '@' + source.lines.length).join('|');
}

export function renderMarkdown(text: string, sources: CodeSource[] = []): string {
  const key = sources.length > 0 ? text + '\u0000' + sourceSignature(sources) : text;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const html = md.render(text, { sources });
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, html);
  return html;
}
