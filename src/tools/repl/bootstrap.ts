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

sandbox.globalThis = sandbox;
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

// A name declared at the top of a block lives on in the context: the agent
// runs a block again with the same const, and an async block must leave
// its names to the next one. A declaration of the column 0 becomes an
// assignment to the global of the context; a destructuring keeps its scope.
const DECLARATION = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const FUNCTION = /^(async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/;
const CLASS = /^class\s+([A-Za-z_$][\w$]*)/;

function hoist(code) {
  return code
    .split('\n')
    .map(function (line) {
      let match = DECLARATION.exec(line);
      if (match) {
        return 'globalThis.' + match[1] + ' =' + line.slice(match[0].length);
      }
      match = FUNCTION.exec(line);
      if (match) {
        return 'globalThis.' + match[2] + ' = ' + line;
      }
      match = CLASS.exec(line);
      if (match) {
        return 'globalThis.' + match[1] + ' = ' + line;
      }
      return line;
    })
    .join('\n');
}

const STATEMENT = /^(?:var|let|const|function|async\s+function|class|if|for|while|do|switch|try|return|throw|import|export|break|continue|\}|\/\/)/;

// The value of the last line of a block, the way the REPL of node shows it.
// The line must be a whole expression; when the guess is wrong, the block
// runs without it and shows no value.
function withReturn(code) {
  const lines = code.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') {
    last--;
  }
  if (last < 0) {
    return undefined;
  }
  const line = lines[last].replace(/;\s*$/, '');
  if (/^\s/.test(line)) {
    return undefined;
  }
  // One line may hold several statements: a; b. The value is the one of the
  // part after the last semicolon.
  const cut = line.lastIndexOf(';');
  const head = cut === -1 ? '' : line.slice(0, cut + 1) + ' ';
  const tail = (cut === -1 ? line : line.slice(cut + 1)).trim();
  if (tail === '' || STATEMENT.test(tail)) {
    return undefined;
  }
  lines[last] = head + 'return (' + tail + ');';
  return lines.join('\n');
}

function compile(code) {
  const body = hoist(code);
  const returning = withReturn(body);
  const wrap = function (text) {
    return '(async () => {\n' + text + '\n})()';
  };
  if (returning !== undefined) {
    try {
      return new vm.Script(wrap(returning), { filename: '<repl>' });
    } catch (err) {
      // The last line was not an expression, the block runs without it.
    }
  }
  return new vm.Script(wrap(body), { filename: '<repl>' });
}

function show(value) {
  if (value !== undefined) {
    outbox.push(
      typeof value === 'string' ? value : util.inspect(value, { depth: 2, maxArrayLength: 200 })
    );
  }
}

// Every block runs as an async function: await works at the top level, and
// a promise of the last line is awaited before its value is shown.
async function runBlock(code) {
  try {
    show(await compile(code).runInContext(context));
  } catch (err) {
    outbox.push(ERROR_MARK + '\n' + (err && err.stack ? err.stack : String(err)));
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

// The blocks run one after another: an async block ends before the next
// one starts, the order of the answers is the order of the calls.
let queue = Promise.resolve();

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
      queue = queue.then(function () {
        return runBlock(code).then(flush);
      });
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


class _Stderr:
    # The writes of the code to stderr go to stdout with a mark, in the order
    # of the prints: the host reads one stream, and a full pipe of stderr no
    # longer stops the process.
    def __init__(self):
        self.partial = ''

    def write(self, text):
        self.partial += str(text)
        while '\n' in self.partial:
            line, self.partial = self.partial.split('\n', 1)
            sys.__stdout__.write('[stderr] ' + line + '\n')
        return len(text)

    def flush(self):
        if self.partial:
            sys.__stdout__.write('[stderr] ' + self.partial + '\n')
            self.partial = ''
        sys.__stdout__.flush()

    def isatty(self):
        return False


sys.stderr = _Stderr()
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
    sys.stderr.flush()
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
