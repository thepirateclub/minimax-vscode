// A tiny MCP server over stdio for the tests of the client: it answers
// initialize, lists one tool and echoes the arguments of the call.
import { createInterface } from 'node:readline';

const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) {
    return;
  }
  if (message.method === 'initialize') {
    // A line of a log on stdout must not break the client.
    process.stdout.write('starting the fake server\n');
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  } else if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          { name: 'echo', description: 'Echo the text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, annotations: { readOnlyHint: true } }
        ]
      }
    });
  } else if (message.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'echo: ' + message.params.arguments.text }] } });
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no method ' + message.method } });
  }
});
