// Исходники bootstrap-скриптов лежат в модуле строкой: сборка extension
// host идёт esbuild одним файлом, отдельный .js рядом с исходником в бандл бы
// не попал. На диск скрипт пишется при первом запуске интерпретатора.
// String.raw держит экранирования как есть: иначе шаблонная строка съела бы
// обратные слэши скрипта.

export const NODE_BOOTSTRAP = String.raw`'use strict';
// Bootstrap of the persistent Node REPL. The extension host writes the code
// blocks into stdin and waits for the marker of the end of the output.
const vm = require('vm');
const util = require('util');
const path = require('path');
const Module = require('module');

const BLOCK_END = process.env.MINIMAX_REPL_BLOCK_END || '';
const OUTPUT_END = process.env.MINIMAX_REPL_OUTPUT_END || '';
const ERROR_MARK = process.env.MINIMAX_REPL_ERROR_MARK || '';

const cwd = process.cwd();
const sandbox = {};
const context = vm.createContext(sandbox);
const outbox = [];

function format(args) {
  return args
    .map(function (arg) {
      return typeof arg === 'string'
        ? arg
        : util.inspect(arg, { depth: 2, maxArrayLength: 200 });
    })
    .join(' ');
}

function push(...args) {
  outbox.push(format(args));
}

const replConsole = {
  log: push,
  info: push,
  debug: push,
  table: push,
  warn: function (...args) {
    outbox.push('[stderr] ' + format(args));
  },
  error: function (...args) {
    outbox.push('[stderr] ' + format(args));
  }
};

sandbox.console = replConsole;
sandbox.process = process;
sandbox.Buffer = Buffer;
sandbox.require = Module.createRequire(path.join(cwd, '__repl__.js'));
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = setInterval;
sandbox.clearInterval = clearInterval;
sandbox.setImmediate = setImmediate;
sandbox.clearImmediate = clearImmediate;
sandbox.queueMicrotask = queueMicrotask;
sandbox.URL = URL;
sandbox.URLSearchParams = URLSearchParams;
sandbox.TextEncoder = TextEncoder;
sandbox.TextDecoder = TextDecoder;
sandbox.structuredClone = typeof structuredClone === 'function' ? structuredClone : undefined;

function runBlock(code) {
  let value;
  try {
    value = vm.runInContext(code, context, { filename: '<repl>' });
  } catch (err) {
    outbox.push(ERROR_MARK + '\n' + (err && err.stack ? err.stack : String(err)));
    return;
  }
  if (value !== undefined) {
    outbox.push(
      typeof value === 'string'
        ? value
        : util.inspect(value, { depth: 2, maxArrayLength: 200 })
    );
  }
}

function flush() {
  if (outbox.length > 0) {
    const payload = outbox.join('\n');
    outbox.length = 0;
    process.stdout.write(payload.endsWith('\n') ? payload : payload + '\n');
  }
  process.stdout.write(OUTPUT_END + '\n');
}

let pending = [];
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line === BLOCK_END) {
      const code = pending.join('\n');
      pending = [];
      runBlock(code);
      flush();
    } else {
      pending.push(line);
    }
    index = buffer.indexOf('\n');
  }
});
`;

export const PYTHON_BOOTSTRAP = String.raw`import ast
import os
import sys
import traceback

BLOCK_END = os.environ.get('MINIMAX_REPL_BLOCK_END', '')
OUTPUT_END = os.environ.get('MINIMAX_REPL_OUTPUT_END', '')
ERROR_MARK = os.environ.get('MINIMAX_REPL_ERROR_MARK', '')

namespace = {'__name__': '__main__'}
outbox = []


def _run(code):
    try:
        exec(compile(code, '<repl>', 'single'), namespace)
        return
    except SyntaxError:
        pass
    # The mode 'single' takes one statement only. A block of several
    # statements goes through 'exec', and the last expression is shown
    # like the interactive interpreter shows it.
    tree = ast.parse(code, '<repl>', 'exec')
    body = tree.body
    if body and isinstance(body[-1], ast.Expr):
        head = ast.Module(body=body[:-1], type_ignores=[])
        exec(compile(head, '<repl>', 'exec'), namespace)
        expression = ast.Expression(body=body[-1].value)
        value = eval(compile(expression, '<repl>', 'eval'), namespace)
        if value is not None:
            sys.displayhook(value)
    else:
        exec(compile(tree, '<repl>', 'exec'), namespace)


def run_block(code):
    try:
        _run(code)
    except BaseException as exc:
        outbox.append(ERROR_MARK)
        outbox.append(''.join(traceback.format_exception(type(exc), exc, exc.__traceback__)))


def flush():
    if outbox:
        payload = '\n'.join(outbox)
        del outbox[:]
        sys.stdout.write(payload if payload.endswith('\n') else payload + '\n')
    sys.stdout.write(OUTPUT_END + '\n')
    sys.stdout.flush()


pending = []
while True:
    line = sys.stdin.readline()
    if not line:
        break
    stripped = line.rstrip('\n')
    if stripped == BLOCK_END:
        run_block('\n'.join(pending))
        pending = []
        flush()
    else:
        pending.append(stripped)
`;
