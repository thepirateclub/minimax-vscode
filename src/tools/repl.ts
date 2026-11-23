import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext, ToolEntry, ToolExecutionResult } from './types';
import { NODE_BOOTSTRAP, PYTHON_BOOTSTRAP } from './repl/bootstrap';

// Маркер конца блока пишет расширение в stdin, маркер конца вывода печатает
// bootstrap. Это разные строки: если бы они совпали, чтение вывода ловило бы
// конец ввода и наоборот.
export const REPL_BLOCK_END = '<<<MINIMAX_REPL_BLOCK_END>>>';
export const REPL_OUTPUT_END = '<<<MINIMAX_REPL_OUTPUT_END>>>';
export const REPL_ERROR_MARK = '@@MINIMAX_REPL_ERROR@@';

export const REPL_DEFAULT_TIMEOUT_MS = 15_000;
export const REPL_MIN_TIMEOUT_MS = 1_000;
export const REPL_MAX_TIMEOUT_MS = 60_000;
export const REPL_MAX_OUTPUT_CHARS = 30_000;
// A chat keeps two interpreters at most, the machine does not hold a process
// per chat that was ever opened.
export const MAX_REPL_PROCESSES = 6;

export type ReplLanguage = 'node' | 'python';

export const REPL_LANGUAGES: readonly ReplLanguage[] = ['node', 'python'];

export interface ReplCommand {
  command: string;
  args: string[];
}

export interface ReplPayload {
  output: string;
  error?: string;
}

// Интерпретаторы ищутся по списку: на Windows python лежит в 'python', на
// Linux часто только 'python3'.
const INTERPRETERS: Record<ReplLanguage, string[]> = {
  node: ['node'],
  python: ['python', 'python3']
};

export function isReplLanguage(value: unknown): value is ReplLanguage {
  return value === 'node' || value === 'python';
}

// Таймаут ограничен сверху и снизу: модель не должна ждать процесс вечно и
// не должна ставить таймаут в одну миллисекунду.
export function resolveReplTimeout(value: unknown): number {
  const parsed = Number(value ?? REPL_DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(parsed)) {
    return REPL_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(REPL_MAX_TIMEOUT_MS, Math.max(REPL_MIN_TIMEOUT_MS, Math.trunc(parsed)));
}

export function truncateReplOutput(text: string, limit: number = REPL_MAX_OUTPUT_CHARS): string {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit) + '\n[output truncated: ' + (text.length - limit) + ' characters cut]';
}

// Команда запуска интерпретатора: сам интерпретатор и путь к bootstrap.
export function buildReplCommand(
  language: ReplLanguage,
  scriptPath: string,
  interpreter?: string
): ReplCommand {
  if (language === 'python') {
    return { command: interpreter ?? 'python', args: ['-u', scriptPath] };
  }
  return { command: interpreter ?? 'node', args: [scriptPath] };
}

// Блок кода уходит в stdin с маркером конца, bootstrap ждёт его.
export function buildReplRequest(code: string): string {
  return code.replace(/\r\n/g, '\n') + '\n' + REPL_BLOCK_END + '\n';
}

// Вывод приходит кусками: маркер конца вывода делит буфер на ответ блока и
// остаток, который достанется следующему вызову.
export function splitReplOutput(raw: string): { output: string; remainder: string } {
  const index = raw.indexOf(REPL_OUTPUT_END);
  if (index < 0) {
    return { output: '', remainder: raw };
  }
  return {
    output: raw.slice(0, index),
    remainder: raw.slice(index + REPL_OUTPUT_END.length)
  };
}

// Ошибка внутри блока приходит с отдельной меткой, всё до неё это обычный
// вывод кода.
export function parseReplPayload(payload: string): ReplPayload {
  const index = payload.indexOf(REPL_ERROR_MARK);
  if (index < 0) {
    return { output: payload.trim() };
  }
  const output = payload.slice(0, index).trim();
  const error = payload.slice(index + REPL_ERROR_MARK.length).trim();
  return error.length > 0 ? { output, error } : { output, error: 'the code failed' };
}

// Выбор интерпретатора: первый доступный из списка.
export async function pickInterpreter(
  candidates: readonly string[],
  isAvailable: (candidate: string) => boolean | Promise<boolean>
): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await isAvailable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

interface ReplWaiter {
  resolve: (payload: ReplPayload) => void;
  timer: NodeJS.Timeout;
}

interface ReplProcess {
  child: ChildProcessWithoutNullStreams;
  buffer: string;
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
    waiter.resolve(parseReplPayload(payload));
  }
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
  const proc: ReplProcess = { child, buffer: '', waiters: [], dead: false };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    proc.buffer += chunk;
    drain(proc);
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

async function executeRepl(
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

export function createReplTools(): ToolEntry[] {
  const node: ToolEntry = {
    name: 'repl_node',
    description:
      'Run JavaScript in a persistent Node.js REPL that belongs to this chat. The process stays alive between the calls, so the variables, the functions and the imports of the previous call are still there. The code runs in the workspace root. Use it to try an idea quickly, to look at the data of the project or to keep a state between the steps of the work. The tool returns the output of the code and the value of the last expression.',
    approval: 'always',
    // Код выполняется, инструмент меняет систему.
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The JavaScript code of the block. The value of the last expression is printed.'
        },
        timeout_ms: {
          type: 'integer',
          minimum: REPL_MIN_TIMEOUT_MS,
          maximum: REPL_MAX_TIMEOUT_MS,
          description: 'Timeout of the block in milliseconds, default 15000.'
        },
        reset: {
          type: 'boolean',
          description: 'Restarts the process and drops the state of the variables.'
        }
      },
      required: ['code']
    },
    async execute(input, ctx) {
      return await executeRepl('node', input, ctx);
    }
  };

  const python: ToolEntry = {
    name: 'repl_python',
    description:
      'Run Python in a persistent REPL that belongs to this chat. The process stays alive between the calls, so the variables, the functions and the imports of the previous call are still there. The code runs in the workspace root. Use it to try an idea quickly, to look at the data of the project or to keep a state between the steps of the work. The tool returns the output of the code and the value of the last expression.',
    approval: 'always',
    // Код выполняется, инструмент меняет систему.
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The Python code of the block. The value of the last expression is printed.'
        },
        timeout_ms: {
          type: 'integer',
          minimum: REPL_MIN_TIMEOUT_MS,
          maximum: REPL_MAX_TIMEOUT_MS,
          description: 'Timeout of the block in milliseconds, default 15000.'
        },
        reset: {
          type: 'boolean',
          description: 'Restarts the process and drops the state of the variables.'
        }
      },
      required: ['code']
    },
    async execute(input, ctx) {
      return await executeRepl('python', input, ctx);
    }
  };

  return [node, python];
}
