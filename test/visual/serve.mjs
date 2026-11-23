// Builds the stand of the panel and serves it on http://localhost:5199.
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const outfile = fileURLToPath(new URL('../../dist/preview/preview.js', import.meta.url));

const ctx = await esbuild.context({
  entryPoints: [fileURLToPath(new URL('./preview.tsx', import.meta.url))],
  bundle: true,
  outfile,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  loader: { '.css': 'text' },
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  logLevel: 'info'
});
await ctx.watch();

const page =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MiniMax panel</title></head>' +
  '<body><div id="root"></div><script src="/preview.js"></script></body></html>';

createServer((request, response) => {
  if ((request.url ?? '').startsWith('/preview.js')) {
    let bundle;
    try {
      bundle = readFileSync(outfile);
    } catch {
      // The watch has not written the bundle yet, the stand answers instead
      // of dying with the exception of a missing file.
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('the bundle is not built yet');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(bundle);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(page);
}).listen(5199, () => console.log('preview on http://localhost:5199'));
