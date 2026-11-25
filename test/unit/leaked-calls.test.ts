import { describe, expect, it } from 'vitest';
import { findLeakedCall, leakedCallNotice, stripLeakedCalls } from '../../src/api/leakedCalls';
import { renderMarkdown } from '../../src/ui/webview/markdown';
import { FakeClient, makeAgent, textResponse, toolResponse } from '../helpers/agentFixture';

const BROKEN = 'Let me read it.\n]<]minimax[>[invoke name="read_file">]<]minimax[>[<path>temp/t39.txt]<]minimax[>[<end_line>50';
const WHOLE = 'Reading.\n<minimax:tool_call>\n<invoke name="search_code">\n<parameter name="query">emit</parameter>\n</invoke>\n</minimax:tool_call>';

// A call of a tool that slipped into the text never ran: the agent asks the
// model to call it again, the panel hides the markup.
describe('a call of a tool in the text', () => {
  it('finds the broken and the whole markup and the tool it names', () => {
    expect(findLeakedCall(BROKEN)).toEqual({ tool: 'read_file', index: 16 });
    expect(findLeakedCall(WHOLE)?.tool).toBe('search_code');
    expect(findLeakedCall('An <invoke> word and minimax alone.')).toBeUndefined();
  });

  it('keeps the words before the markup and drops the rest', () => {
    expect(stripLeakedCalls(BROKEN)).toBe('Let me read it.');
    expect(stripLeakedCalls(WHOLE)).toBe('Reading.');
    expect(stripLeakedCalls('plain')).toBe('plain');
  });

  it('is not drawn in the answer of the panel', () => {
    const html = renderMarkdown(BROKEN);
    expect(html).toContain('Let me read it.');
    expect(html).not.toContain('minimax');
  });

  it('makes the agent ask for the call again, and the call then runs', async () => {
    const client = new FakeClient([textResponse(BROKEN), toolResponse('read_file', { path: 'temp/t39.txt' }), textResponse('done')]);
    const { agent, events } = makeAgent(client);
    const result = await agent.run('read it', []);
    const nudge = client.requests[1]!.messages[client.requests[1]!.messages.length - 1]!;
    expect(nudge.role).toBe('user');
    expect(JSON.stringify(nudge.content)).toContain(leakedCallNotice({ tool: 'read_file', index: 0 }).slice(0, 30));
    expect(events.some((event) => event.type === 'tool_end' && event.name === 'read_file')).toBe(true);
    expect(result.stopReason).toBe('end_turn');
  });

  it('gives up after two leaks in a row, the turn ends with the answer', async () => {
    const client = new FakeClient([textResponse(BROKEN), textResponse(BROKEN), textResponse(BROKEN)]);
    const { agent } = makeAgent(client);
    await agent.run('read it', []);
    expect(client.requests.length).toBe(3);
  });
});
