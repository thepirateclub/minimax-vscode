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
export const INTERPRETERS: Record<ReplLanguage, string[]> = {
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
