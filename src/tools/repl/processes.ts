import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext, ToolExecutionResult } from '../types';
import { NODE_BOOTSTRAP, PYTHON_BOOTSTRAP } from './bootstrap';
import {
  buildReplCommand,
  buildReplRequest,
  INTERPRETERS,
  MAX_REPL_PROCESSES,
  parseReplPayload,
  pickInterpreter,
  REPL_BLOCK_END,
  REPL_ERROR_MARK,
  REPL_OUTPUT_END,
  resolveReplTimeout,
  truncateReplOutput,
  type ReplLanguage,
  type ReplPayload
} from './protocol';

interface ReplWaiter {
  resolve: (payload: ReplPayload) => void;
  timer: NodeJS.Timeout;
}

interface ReplProcess {
  child: ChildProcessWithoutNullStreams;
  buffer: string;
  // What the process wrote to stderr past the bootstrap: a native module, a
  // child process. It goes with the next answer.
  stderr: string;
  waiters: ReplWaiter[];
  dead: boolean;
}

// Процессы живут между вызовами, ключ это пара из чата и языка.
const processes = new Map<string, ReplProcess>();
const interpreterCache = new Map<ReplLanguage, { at: number; command?: string }>();
const INTERPRETER_CACHE_MS = 60_000;

let scriptDir: string | undefined;
const scriptPaths = new Map<ReplLanguage, string>();

// Хост зовёт функцию при старте нового чата: процессы старого чата закрываются,
// состояние переменных не должно пережить смену чата.
export function resetReplProcesses(): void {
  for (const proc of processes.values()) {
    stopProcess(proc);
  }
  processes.clear();
  interpreterCache.clear();
}

// The processes of one chat. A deleted chat must not keep a live interpreter,
// and a new chat must not kill the interpreters of the chats that still work.
export function stopReplSession(sessionId: string): void {
  const prefix = sessionId + '::';
  for (const [key, proc] of [...processes]) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    stopProcess(proc);
    processes.delete(key);
  }
}

// The map does not grow with every chat that ever ran a block: the oldest
// process that waits for nothing goes away.
function trimProcesses(keep: string): void {
  if (processes.size < MAX_REPL_PROCESSES) {
    return;
  }
  for (const [key, proc] of [...processes]) {
    if (key === keep || proc.waiters.length > 0) {
      continue;
    }
    stopProcess(proc);
    processes.delete(key);
    return;
  }
}

// Bootstrap пишется во временный каталог: файл рядом с исходником в сборку
// esbuild не попал бы.
function bootstrapPath(language: ReplLanguage): string {
  const cached = scriptPaths.get(language);
  if (cached) {
    return cached;
  }
  if (!scriptDir) {
    scriptDir = mkdtempSync(join(tmpdir(), 'minimax-repl-'));
  }
  const source = language === 'python' ? PYTHON_BOOTSTRAP : NODE_BOOTSTRAP;
  const file = join(scriptDir, language === 'python' ? 'bootstrap.py' : 'bootstrap.cjs');
  writeFileSync(file, source, 'utf8');
  scriptPaths.set(language, file);
  return file;
}

async function probeInterpreter(command: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    execFile(
      command,
      ['--version'],
      { timeout: 5000, windowsHide: true },
      (error) => resolve(!error)
    );
  });
}

async function findInterpreter(language: ReplLanguage): Promise<string | undefined> {
  const cached = interpreterCache.get(language);
  if (cached && Date.now() - cached.at < INTERPRETER_CACHE_MS) {
    return cached.command;
  }
  const command = await pickInterpreter(INTERPRETERS[language], probeInterpreter);
  interpreterCache.set(language, { at: Date.now(), command });
  return command;
}

function stopProcess(proc: ReplProcess): void {
  proc.dead = true;
  for (const waiter of proc.waiters.splice(0, proc.waiters.length)) {
    clearTimeout(waiter.timer);
    waiter.resolve({ output: '', error: 'the process of the REPL is stopped' });
  }
  try {
    proc.child.kill();
  } catch {
    // Процесс уже мёртв, закрывать его не нужно.
  }
}

// Ответ блока закрывает первый ожидающий вызов: порядок блоков совпадает с
// порядком вызовов, потому что один чат говорит с одним процессом.
function drain(proc: ReplProcess): void {
  while (proc.waiters.length > 0) {
    const index = proc.buffer.indexOf(REPL_OUTPUT_END);
    if (index < 0) {
      return;
    }
    const payload = proc.buffer.slice(0, index);
    proc.buffer = proc.buffer.slice(index + REPL_OUTPUT_END.length);
    const waiter = proc.waiters.shift();
    if (!waiter) {
      return;
    }
    clearTimeout(waiter.timer);
    waiter.resolve(withStderr(parseReplPayload(payload), proc));
  }
}

const MAX_STDERR_CHARS = 10_000;

function withStderr(payload: ReplPayload, proc: ReplProcess): ReplPayload {
  const text = proc.stderr.trim();
  proc.stderr = '';
  if (text.length === 0) {
    return payload;
  }
  const marked = text
    .split(/\r?\n/)
    .map((line) => '[stderr] ' + line)
    .join('\n');
  return { ...payload, output: payload.output.length > 0 ? payload.output + '\n' + marked : marked };
}

function startProcess(
  language: ReplLanguage,
  cwd: string,
  interpreter: string
): ReplProcess {
  const script = bootstrapPath(language);
  const { command, args } = buildReplCommand(language, script, interpreter);
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    env: {
      ...process.env,
      MINIMAX_REPL_BLOCK_END: REPL_BLOCK_END,
      MINIMAX_REPL_OUTPUT_END: REPL_OUTPUT_END,
      MINIMAX_REPL_ERROR_MARK: REPL_ERROR_MARK
    }
  });
  const proc: ReplProcess = { child, buffer: '', stderr: '', waiters: [], dead: false };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    proc.buffer += chunk;
    drain(proc);
  });
  // The pipe of stderr is read always: a full pipe stops the process, and the
  // block waits for its timeout.
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    proc.stderr = (proc.stderr + chunk).slice(-MAX_STDERR_CHARS);
  });
  child.on('error', () => {
    stopProcess(proc);
  });
  child.on('exit', (code) => {
    if (!proc.dead) {
      proc.dead = true;
      for (const waiter of proc.waiters.splice(0, proc.waiters.length)) {
        clearTimeout(waiter.timer);
        waiter.resolve({
          output: '',
          error: 'the process of the REPL exited with code ' + String(code ?? 0)
        });
      }
    }
  });
  return proc;
}

function runBlock(
  proc: ReplProcess,
  code: string,
  timeoutMs: number
): Promise<ReplPayload> {
  return new Promise<ReplPayload>((resolve) => {
    const timer = setTimeout(() => {
      const index = proc.waiters.findIndex((waiter) => waiter.timer === timer);
      if (index >= 0) {
        proc.waiters.splice(index, 1);
      }
      // Процесс без ответа не восстановить: он закрывается, следующий вызов
      // поднимет новый.
      stopProcess(proc);
      resolve({
        output: '',
        error: 'the code did not finish in ' + timeoutMs + ' ms, the process was stopped'
      });
    }, timeoutMs);
    proc.waiters.push({ resolve, timer });
    try {
      proc.child.stdin.write(buildReplRequest(code));
    } catch (error) {
      clearTimeout(timer);
      proc.waiters.pop();
      resolve({
        output: '',
        error: 'the process of the REPL is not alive: ' + String(error)
      });
    }
  });
}

export async function executeRepl(
  language: ReplLanguage,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolExecutionResult> {
  const code = String(input['code'] ?? '');
  if (code.trim().length === 0) {
    return {
      content: 'repl_' + language + ' failed: the code is empty',
      isError: true
    };
  }
  const timeout = resolveReplTimeout(input['timeout_ms']);

  const sessionId = ctx.sessionId ?? 'default';
  const key = sessionId + '::' + language;

  let proc = processes.get(key);
  if (input['reset'] === true && proc) {
    stopProcess(proc);
    processes.delete(key);
    proc = undefined;
  }
  if (!proc || proc.dead) {
    const interpreter = await findInterpreter(language);
    if (!interpreter) {
      return {
        content:
          'repl_' +
          language +
          ' failed: the ' +
          language +
          ' interpreter is not installed, the tool cannot run the code',
        isError: true
      };
    }
    try {
      proc = startProcess(language, ctx.workspaceRoot, interpreter);
    } catch (error) {
      return {
        content:
          'repl_' +
          language +
          ' failed: ' +
          (error instanceof Error ? error.message : String(error)),
        isError: true
      };
    }
    trimProcesses(key);
    processes.set(key, proc);
    ctx.logger.info('the REPL of ' + language + ' started for the session ' + sessionId);
  }

  const payload = await runBlock(proc, code, timeout);
  if (proc.dead) {
    processes.delete(key);
  }
  const parts: string[] = [];
  if (payload.output.length > 0) {
    parts.push(payload.output);
  }
  if (payload.error !== undefined) {
    parts.push('[error] ' + payload.error);
  }
  const text = parts.join('\n');
  return {
    content: truncateReplOutput(text.length > 0 ? text : '[no output]'),
    isError: payload.error !== undefined
  };
}
