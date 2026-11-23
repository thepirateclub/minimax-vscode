import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const specPath = process.argv[2];
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const path = 'src/extension.ts';
const raw = readFileSync(path, 'utf8');
const useCrlf = raw.includes('\r\n');
const toLf = (t) => t.replace(/\r\n/g, '\n');
const toCrlf = (t) => (useCrlf ? t.replace(/\n/g, '\r\n') : t);
const lines = toLf(raw).split('\n');
const joined = lines.join('\n');

function lineStart(index) {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += lines[i].length + 1;
  return offset;
}

function findParenClose(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findBraceClose(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const registryPath = 'scripts/moved.json';
const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : {};
const movedNames = new Set(Object.keys(registry));
for (const name of spec.names) movedNames.add(name);

const moved = [];
const ranges = [];
for (const name of spec.names) {
  const pattern = new RegExp('^  (private |protected )?(async )?' + name + '\\(');
  const index = lines.findIndex((line) => pattern.test(line));
  if (index < 0) throw new Error('method not found: ' + name);
  const start = lineStart(index);
  const openParen = joined.indexOf('(', start);
  const closeParen = findParenClose(joined, openParen);
  if (closeParen < 0) throw new Error('no params end: ' + name);
  const brace = joined.indexOf('{', closeParen);
  const semi = joined.indexOf(';', closeParen);
  if (semi >= 0 && semi < brace) throw new Error('abstract method: ' + name);
  const closeBrace = findBraceClose(joined, brace);
  if (closeBrace < 0) throw new Error('no body end: ' + name);
  let end = closeBrace + 1;
  while (joined[end] === '\n' || joined[end] === '\r') end += 1;
  const text = joined.slice(start, end).replace(/\n$/, '');
  moved.push({ name, text });
  ranges.push([start, end]);
}

function toFunction(text) {
  const open = text.indexOf('(');
  const close = findParenClose(text, open);
  const params = text.slice(open + 1, close).trim();
  const hostParam = 'host: MiniMaxController' + (params.length > 0 ? ', ' + params : '');
  let out = text.slice(0, open + 1) + hostParam + text.slice(close);
  out = out.replace(/^\s+(private |protected )?/, '');
  out = out
    .split('\n')
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n');
  out = out.startsWith('async ')
    ? 'export async function ' + out.slice(6)
    : 'export function ' + out;
  out = out.replace(/\bthis\./g, 'host.');
  out = out.replace(/\((host), \)/g, '($1)');
  for (const other of movedNames) {
    out = out.replace(new RegExp('host\\.' + other + '\\(', 'g'), other + '(host, ');
  }
  return out;
}

const functions = moved.map((m) => toFunction(m.text));
const earlier = Object.entries(registry).map(
  ([name, module]) => 'import { ' + name + " } from '" + module.replace('./host/', './') + "';"
);
const header = [
  "import type { MiniMaxController } from '../extension';",
  ...spec.imports,
  ...earlier
].join('\n');
const moduleText = header + '\n\n' + functions.join('\n\n') + '\n';
writeFileSync('src/host/' + spec.module + '.ts', toCrlf(moduleText));

let updated = joined;
for (const range of ranges.sort((a, b) => b[0] - a[0])) {
  updated = updated.slice(0, range[0]) + updated.slice(range[1]);
}
for (const name of spec.names) {
  updated = updated.replace(new RegExp('this\\.' + name + '\\(', 'g'), name + '(this, ');
}
for (const constant of spec.removeConstants ?? []) {
  const escaped = constant.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
  updated = updated.replace(new RegExp('^' + escaped + '$', 'm') + '\n', '');
}
const importLine = 'import { ' + spec.names.join(', ') + " } from './host/" + spec.module + "';";
const importLines = updated.split('\n');
let lastImport = -1;
for (let i = 0; i < importLines.length; i++) if (importLines[i].startsWith('import ')) lastImport = i;
importLines.splice(lastImport + 1, 0, importLine);
updated = importLines.join('\n').replace(/\n{3,}/g, '\n\n');
writeFileSync(path, toCrlf(updated));

for (const name of spec.names) registry[name] = './host/' + spec.module;
writeFileSync(registryPath, JSON.stringify(registry, null, 1));
console.log(JSON.stringify({
  module: spec.module,
  functions: spec.names,
  moduleLines: moduleText.split('\n').length,
  extensionLines: updated.split('\n').length
}));
