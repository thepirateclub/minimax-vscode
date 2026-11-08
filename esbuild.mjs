import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info'
};

const webviewConfig = {
  entryPoints: ['src/ui/webview/main.tsx'],
  bundle: true,
  outfile: 'dist/webview/main.js',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  sourcemap: !production,
  minify: production,
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': production ? '"production"' : '"development"' },
  logLevel: 'info'
};

if (watch) {
  await Promise.all([
    esbuild.context(extensionConfig).then((ctx) => ctx.watch()),
    esbuild.context(webviewConfig).then((ctx) => ctx.watch())
  ]);
  console.log('watching...');
} else {
  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}
