import { describe, expect, it } from 'vitest';
import { StreamDecoder, parseSseChunk } from '../../src/api/sse';

describe('parseSseChunk', () => {
  it('extracts complete events and keeps the remainder', () => {
    const { events, rest } = parseSseChunk('event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\npart');
    expect(events).toHaveLength(2);
    expect(events[0]?.event).toBe('a');
    expect(events[0]?.data).toBe('{"x":1}');
    expect(rest).toBe('part');
  });

  it('joins multiple data lines with a newline', () => {
    const { events } = parseSseChunk('event: a\ndata: one\ndata: two\n\n');
    expect(events[0]?.data).toBe('one\ntwo');
  });

  it('handles CRLF line endings', () => {
    const { events } = parseSseChunk('event: a\r\ndata: 1\r\n\r\n');
    expect(events[0]?.data).toBe('1');
  });
});

describe('StreamDecoder', () => {
  it('emits text deltas and a final message_stop', () => {
    const decoder = new StreamDecoder();
    const events = [
      ...decoder.push('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":0}}}\n\n'),
      ...decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n'),
      ...decoder.push('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'),
      ...decoder.push('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    ];
    const text = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
    expect(text).toBe('Hello');
    const stop = events.find((e) => e.type === 'message_stop');
    expect(stop?.stopReason).toBe('end_turn');
    expect(stop?.usage.inputTokens).toBe(11);
    expect(stop?.usage.outputTokens).toBe(5);
  });

  it('takes the counters of the request from message_delta', () => {
    const decoder = new StreamDecoder();
    const events = [
      ...decoder.push('event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}\n\n'),
      ...decoder.push('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":11,"output_tokens":22,"cache_read_input_tokens":197}}\n\n'),
      ...decoder.push('event: message_stop\ndata: {"type":"message_stop"}\n\n')
    ];
    const stop = events.find((e) => e.type === 'message_stop');
    expect(stop?.usage.inputTokens).toBe(11);
    expect(stop?.usage.outputTokens).toBe(22);
    expect(stop?.usage.cacheReadTokens).toBe(197);
  });

  it('keeps thinking blocks separate from text', () => {
    const decoder = new StreamDecoder();
    const events = [
      ...decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"why"}}\n\n')
    ];
    expect(events.some((e) => e.type === 'thinking_delta')).toBe(true);
    expect(events.some((e) => e.type === 'text_delta')).toBe(false);
  });

  it('accumulates tool use arguments from partial json', () => {
    const decoder = new StreamDecoder();
    const events = [
      ...decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":"}}\n\n'),
      ...decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"a.ts\\"}"}}\n\n')
    ];
    expect(events.some((e) => e.type === 'tool_use_start')).toBe(true);
    const stop = decoder.flush()[0];
    expect(stop?.type).toBe('message_stop');
    if (stop?.type === 'message_stop') {
      const block = stop.blocks[0];
      expect(block?.type).toBe('tool_use');
      if (block?.type === 'tool_use') {
        expect(block.id).toBe('toolu_1');
        expect(block.name).toBe('read_file');
        expect(block.input).toEqual({ path: 'a.ts' });
      }
    }
  });

  it('reports broken tool arguments without throwing', () => {
    const decoder = new StreamDecoder();
    decoder.push('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_file","input":{}}}\n\n');
    decoder.push('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{broken"}}\n\n');
    const stop = decoder.flush()[0];
    if (stop?.type === 'message_stop') {
      const block = stop.blocks[0];
      if (block?.type === 'tool_use') {
        expect(block.input).toEqual({});
      }
    }
  });

  it('ignores unknown event types', () => {
    const decoder = new StreamDecoder();
    expect(decoder.push('event: ping\ndata: {}\n\n')).toHaveLength(0);
  });
});
