import { createServer, type Server } from 'node:http';

export interface FakeServerOptions {
  status?: number;
  body?: string;
  chunks?: string[];
}

export interface FakeServer {
  url: string;
  requests: Array<{ headers: Record<string, string | string[] | undefined>; body: string }>;
  close(): Promise<void>;
}

export async function startFakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += String(chunk);
    });
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      const status = options.status ?? 200;
      res.writeHead(status, { 'Content-Type': 'text/event-stream' });
      if (status !== 200) {
        res.end(options.body ?? '{"error":{"type":"invalid_request_error","message":"boom"}}');
        return;
      }
      const chunks = options.chunks ?? [
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n'
      ];
      for (const chunk of chunks) {
        res.write(chunk);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('fake server did not bind');
  }
  return {
    url: 'http://127.0.0.1:' + address.port,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
  };
}
