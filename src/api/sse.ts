import type {
  AnthropicContentBlock,
  StopReason,
  StreamEvent,
  Usage
} from './types';

export interface SseEvent {
  event: string;
  data: string;
}

export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: SseEvent[] = [];
  for (const block of blocks) {
    if (block.trim().length === 0) {
      continue;
    }
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length > 0) {
      events.push({ event, data: dataLines.join('\n') });
    }
  }
  return { events, rest };
}

interface BlockState {
  kind: 'text' | 'thinking' | 'tool_use';
  text: string;
  json: string;
  id: string;
  name: string;
}

export class StreamDecoder {
  private buffer = '';
  private readonly blocks = new Map<number, BlockState>();
  private stopReason: StopReason = 'end_turn';
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;
  private done = false;

  // The answer ended with the event of the server. A stream that stops in the
  // middle is a broken connection, the client repeats the request.
  get finished(): boolean {
    return this.done;
  }

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const { events, rest } = parseSseChunk(this.buffer);
    this.buffer = rest;
    const out: StreamEvent[] = [];
    for (const sse of events) {
      const parsed = this.handle(sse);
      if (parsed) {
        out.push(...parsed);
      }
    }
    return out;
  }

  flush(): StreamEvent[] {
    const out: StreamEvent[] = [];
    if (this.buffer.trim().length > 0) {
      const { events, rest } = parseSseChunk(this.buffer + '\n\n');
      this.buffer = rest;
      for (const sse of events) {
        const parsed = this.handle(sse);
        if (parsed) {
          out.push(...parsed);
        }
      }
    }
    if (!this.done) {
      this.done = true;
      out.push({
        type: 'message_stop',
        stopReason: this.stopReason,
        usage: this.usage(),
        blocks: this.buildBlocks()
      });
    }
    return out;
  }

  private handle(sse: SseEvent): StreamEvent[] | null {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(sse.data) as Record<string, unknown>;
    } catch {
      return null;
    }
    const type = typeof payload['type'] === 'string' ? (payload['type'] as string) : sse.event;

    if (type === 'message_start') {
      const message = payload['message'] as
        | { usage?: { input_tokens?: number; cache_read_input_tokens?: number } }
        | undefined;
      this.inputTokens = message?.usage?.input_tokens ?? 0;
      this.cacheReadTokens = message?.usage?.cache_read_input_tokens ?? 0;
      return [{ type: 'message_start', usage: this.usage() }];
    }

    if (type === 'content_block_start') {
      const index = Number(payload['index'] ?? 0);
      const block = payload['content_block'] as
        | { type?: string; thinking?: string; id?: string; name?: string }
        | undefined;
      const kind =
        block?.type === 'thinking' ? 'thinking' : block?.type === 'tool_use' ? 'tool_use' : 'text';
      this.blocks.set(index, {
        kind,
        text: kind === 'thinking' ? (block?.thinking ?? '') : '',
        json: '',
        id: block?.id ?? '',
        name: block?.name ?? ''
      });
      if (kind === 'tool_use') {
        return [{ type: 'tool_use_start', id: block?.id ?? '', name: block?.name ?? '' }];
      }
      return [];
    }

    if (type === 'content_block_delta') {
      const index = Number(payload['index'] ?? 0);
      const delta = payload['delta'] as
        | { type?: string; text?: string; thinking?: string; partial_json?: string }
        | undefined;
      const state = this.blocks.get(index);
      if (delta?.type === 'text_delta') {
        const text = delta.text ?? '';
        if (state) {
          state.text += text;
        }
        return [{ type: 'text_delta', text }];
      }
      if (delta?.type === 'thinking_delta') {
        const text = delta.thinking ?? '';
        if (state) {
          state.text += text;
        }
        return [{ type: 'thinking_delta', text }];
      }
      if (delta?.type === 'input_json_delta') {
        const partialJson = delta.partial_json ?? '';
        if (state) {
          state.json += partialJson;
        }
        return [{ type: 'tool_use_delta', id: state?.id ?? '', partialJson }];
      }
      return [];
    }

    if (type === 'message_stop') {
      this.done = true;
      return [
        {
          type: 'message_stop',
          stopReason: this.stopReason,
          usage: this.usage(),
          blocks: this.buildBlocks()
        }
      ];
    }

    if (type === 'error') {
      // The server tells that it failed. The event used to fall through and
      // the turn looked like a finished answer with no text.
      const failure = payload['error'] as { message?: string } | undefined;
      return [
        {
          type: 'stream_error',
          message: failure?.message ?? 'MiniMax reported an error in the middle of the answer.'
        }
      ];
    }

    if (type === 'message_delta') {
      const delta = payload['delta'] as { stop_reason?: StopReason } | undefined;
      if (delta?.stop_reason) {
        this.stopReason = delta.stop_reason;
      }
      // MiniMax puts the real counters of the request into message_delta,
      // the message_start block always carries zeros.
      const usage = payload['usage'] as
        | {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          }
        | undefined;
      if (typeof usage?.input_tokens === 'number') {
        this.inputTokens = usage.input_tokens;
      }
      if (typeof usage?.output_tokens === 'number') {
        this.outputTokens = usage.output_tokens;
      }
      if (typeof usage?.cache_read_input_tokens === 'number') {
        this.cacheReadTokens = usage.cache_read_input_tokens;
      }
      if (typeof usage?.cache_creation_input_tokens === 'number') {
        this.cacheCreationTokens = usage.cache_creation_input_tokens;
      }
      return [];
    }

    return null;
  }

  private usage(): Usage {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheCreationTokens: this.cacheCreationTokens
    };
  }

  private buildBlocks(): AnthropicContentBlock[] {
    const out: AnthropicContentBlock[] = [];
    const indexes = [...this.blocks.keys()].sort((a, b) => a - b);
    for (const index of indexes) {
      const state = this.blocks.get(index);
      if (!state) {
        continue;
      }
      if (state.kind === 'text') {
        if (state.text.length > 0) {
          out.push({ type: 'text', text: state.text });
        }
      } else if (state.kind === 'thinking') {
        if (state.text.length > 0) {
          out.push({ type: 'thinking', thinking: state.text });
        }
      } else {
        let input: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(state.json.length > 0 ? state.json : '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          input = {};
        }
        out.push({ type: 'tool_use', id: state.id, name: state.name, input });
      }
    }
    return out;
  }
}
