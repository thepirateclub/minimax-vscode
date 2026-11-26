import type { MiniMaxClient } from '../api/client';
import type { AnthropicMessage, Usage } from '../api/types';

// The old turns that the cut of the history throws away are not lost: one
// request without tools writes their digest, and the digest stands in the
// system prompt of every next turn. A long task keeps its thread: the goal,
// the decisions and the files stay known after the cut.
const DIGEST_PROMPT = [
  'You compress the earlier part of a coding session between a user and an agent.',
  'Write a digest the agent will read instead of these messages. Keep:',
  '- the goal of the user and every constraint or preference they stated;',
  '- the decisions made and why;',
  '- the files read or changed, with what was learned or done in each;',
  '- the commands run and their outcome;',
  '- the open problems and the next steps.',
  'Merge the previous digest if one is given. Plain text, short bullet points, at most 400 words. No preamble.'
].join('\n');

// The text of the dropped messages for the summarizer, bounded.
const MAX_SOURCE_CHARS = 60_000;
const MAX_RESULT_CHARS = 600;
const MAX_DIGEST_TOKENS = 4096;

export function renderMessages(messages: readonly AnthropicMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'text' && block.text.trim().length > 0) {
        lines.push(message.role + ': ' + block.text.trim());
      } else if (block.type === 'tool_use') {
        lines.push('tool call ' + block.name + ' ' + JSON.stringify(block.input).slice(0, 300));
      } else if (block.type === 'tool_result') {
        const content = block.content;
        lines.push(
          'tool result' + (block.is_error ? ' (error)' : '') + ': ' +
            (content.length > MAX_RESULT_CHARS ? content.slice(0, MAX_RESULT_CHARS) + ' ...' : content)
        );
      }
    }
  }
  const text = lines.join('\n');
  // The newest part matters more: the head of an overflow goes.
  return text.length > MAX_SOURCE_CHARS ? '...\n' + text.slice(-MAX_SOURCE_CHARS) : text;
}

export async function summarizeHistory(options: {
  client: MiniMaxClient;
  model: string;
  previous: string | undefined;
  dropped: readonly AnthropicMessage[];
  signal?: AbortSignal;
}): Promise<{ digest: string; usage: Usage }> {
  const parts: string[] = [];
  if (options.previous) {
    parts.push('Previous digest:\n' + options.previous);
  }
  parts.push('Messages to compress:\n' + renderMessages(options.dropped));
  let text = '';
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const request = {
    model: options.model,
    maxTokens: MAX_DIGEST_TOKENS,
    system: DIGEST_PROMPT,
    messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: parts.join('\n\n') }] }]
  };
  for await (const event of options.client.stream(request, options.signal ? { signal: options.signal } : undefined)) {
    if (event.type === 'text_delta') {
      text += event.text;
    } else if (event.type === 'stream_error') {
      throw new Error(event.message);
    } else if (event.type === 'message_stop') {
      usage = event.usage;
    }
  }
  return { digest: text.trim(), usage };
}

export function withDigest(systemPrompt: string, digest: string | undefined): string {
  return digest && digest.length > 0
    ? systemPrompt + '\n\nEarlier in this session (a digest of the turns that no longer fit the context):\n' + digest
    : systemPrompt;
}
