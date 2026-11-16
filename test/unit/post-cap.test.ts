import { describe, expect, it } from 'vitest';
import { MAX_POST_CHARS, POST_CUT, capPost, capText } from '../../src/ui/postCap';

describe('the volume of a message to the panel', () => {
  it('keeps a small message as it is', () => {
    const message = capPost({
      type: 'tool_end',
      id: 't1',
      name: 'read',
      content: 'the content of the file',
      isError: false
    });
    expect(message.type).toBe('tool_end');
    if (message.type !== 'tool_end') {
      throw new Error('the message is not the result of a tool');
    }
    expect(message.content).toBe('the content of the file');
  });

  it('cuts a huge result of a tool', () => {
    const message = capPost({
      type: 'tool_end',
      id: 't1',
      name: 'read',
      content: 'x'.repeat(MAX_POST_CHARS + 1000),
      isError: false
    });
    if (message.type !== 'tool_end') {
      throw new Error('the message is not the result of a tool');
    }
    expect(message.content.length).toBeLessThanOrEqual(MAX_POST_CHARS);
    // The reader has to know that the result is not whole.
    expect(message.content).toContain(POST_CUT);
  });

  it('cuts the text of the history of the panel', () => {
    const message = capPost({
      type: 'session_loaded',
      messages: [
        { id: 'a1', role: 'assistant', text: 'x'.repeat(MAX_POST_CHARS + 1000) },
        { id: 'a2', role: 'assistant', text: 'the answer' }
      ],
      olderMessages: 0
    });
    if (message.type !== 'session_loaded') {
      throw new Error('the message is not the history');
    }
    expect(message.messages[0]?.text?.length).toBeLessThanOrEqual(MAX_POST_CHARS);
    expect(message.messages[0]?.text).toContain(POST_CUT);
    expect(message.messages[1]?.text).toBe('the answer');
  });

  it('keeps the head and the tail of a cut text', () => {
    const text = capText('a'.repeat(50) + 'b'.repeat(50), 40);
    expect(text?.length).toBe(40);
    expect(text?.startsWith('a')).toBe(true);
    expect(text?.endsWith('b')).toBe(true);
  });
});
