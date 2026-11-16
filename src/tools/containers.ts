import { execFile } from 'node:child_process';
import type { ToolEntry } from './types';

export type ContainerRuntime = 'podman' | 'docker';

// Podman проверяется первым: он не требует демона и работает без Docker
// Desktop. Если его нет, берётся docker.
export const CONTAINER_RUNTIMES: readonly ContainerRuntime[] = ['podman', 'docker'];

export const CONTAINER_MAX_OUTPUT_CHARS = 30_000;
export const CONTAINER_READ_TIMEOUT_MS = 30_000;
export const CONTAINER_RUN_TIMEOUT_MS = 60_000;
export const CONTAINER_PROBE_TIMEOUT_MS = 5_000;

export interface ContainerRunOptions {
  image: string;
  name?: string;
  command?: string[];
  detach?: boolean;
}

export interface ContainerResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Выбор рантайма вынесен в чистую функцию: тест проверяет порядок без
// установленного docker.
export async function pickContainerRuntime(
  candidates: readonly ContainerRuntime[],
  isAvailable: (runtime: ContainerRuntime) => boolean | Promise<boolean>
): Promise<ContainerRuntime | undefined> {
  for (const runtime of candidates) {
    if (await isAvailable(runtime)) {
      return runtime;
    }
  }
  return undefined;
}

// Имя контейнера не может начинаться с дефиса: иначе это опция рантайма, а не
// имя. Остальное ограничение взято из правил имён docker.
export function isValidContainerName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name);
}

export function isValidContainerImage(image: string): boolean {
  return image.length > 0 && !image.startsWith('-');
}

// Команда приходит массивом: строку делить по пробелам небезопасно, кавычки
// и пробелы внутри аргумента теряются.
export function parseCommandArg(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.split(/\s+/) : [];
  }
  return [];
}

export function buildListArgs(): string[] {
  return ['ps', '--all', '--format', '{{.Names}}\t{{.Image}}\t{{.Status}}'];
}

export function buildImagesArgs(): string[] {
  return ['images', '--format', '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}'];
}

export function buildLogsArgs(name: string, tail: number): string[] {
  return ['logs', '--tail', String(tail), name];
}

export function buildRunArgs(options: ContainerRunOptions): string[] {
  const args = ['run'];
  if (options.name !== undefined && options.name.length > 0) {
    args.push('--name', options.name);
  }
  if (options.detach !== false) {
    args.push('--detach');
  }
  args.push(options.image);
  if (options.command !== undefined && options.command.length > 0) {
    args.push(...options.command);
  }
  return args;
}

export function buildStopArgs(name: string): string[] {
  return ['stop', name];
}

export function buildExecArgs(name: string, command: string[]): string[] {
  return ['exec', name, ...command];
}

export function truncateContainerOutput(
  text: string,
  limit: number = CONTAINER_MAX_OUTPUT_CHARS
): string {
  if (text.length <= limit) {
    return text;
  }
  return text.slice(0, limit) + '\n[output truncated: ' + (text.length - limit) + ' characters cut]';
}

let runtimeCache: { at: number; runtime?: ContainerRuntime } | undefined;
const RUNTIME_CACHE_MS = 60_000;

export function resetContainerRuntimeCache(): void {
  runtimeCache = undefined;
}

async function probeRuntime(runtime: ContainerRuntime): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    execFile(
      runtime,
      ['--version'],
      { timeout: CONTAINER_PROBE_TIMEOUT_MS, windowsHide: true },
      (error) => resolve(!error)
    );
  });
}

// Рантайм ищется один раз в минуту: проверка стоит дорого, а список
// контейнеров модель зовёт часто.
async function detectRuntime(): Promise<ContainerRuntime | undefined> {
  if (runtimeCache && Date.now() - runtimeCache.at < RUNTIME_CACHE_MS) {
    return runtimeCache.runtime;
  }
  const runtime = await pickContainerRuntime(CONTAINER_RUNTIMES, probeRuntime);
  runtimeCache = { at: Date.now(), runtime };
  return runtime;
}

async function runRuntime(
  runtime: ContainerRuntime,
  args: string[],
  timeoutMs: number
): Promise<ContainerResult> {
  return await new Promise<ContainerResult>((resolve) => {
    execFile(
      runtime,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = typeof error.code === 'number' ? error.code : 1;
        resolve({
          code,
          stdout: typeof stdout === 'string' ? stdout : '',
          stderr: stderr && stderr.length > 0 ? stderr : error.message
        });
      }
    );
  });
}

function formatResult(result: ContainerResult): string {
  const parts: string[] = [];
  if (result.stdout.trim().length > 0) {
    parts.push(result.stdout.trim());
  }
  if (result.stderr.trim().length > 0) {
    parts.push('[stderr] ' + result.stderr.trim());
  }
  return parts.join('\n');
}

const NO_RUNTIME_TEXT = 'neither podman nor docker is installed';

async function requireRuntime(): Promise<
  { runtime: ContainerRuntime } | { error: string }
> {
  const runtime = await detectRuntime();
  if (!runtime) {
    return { error: NO_RUNTIME_TEXT };
  }
  return { runtime };
}

export function createContainerTools(): ToolEntry[] {
  const list: ToolEntry = {
    name: 'container_list',
    description:
      'List the containers and the images of the container runtime of the machine (podman or docker). Returns the running and the stopped containers with their images and the images that are stored locally. The tool only reads the state of the runtime.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    async execute() {
      const found = await requireRuntime();
      if ('error' in found) {
        return { content: 'container_list failed: ' + found.error, isError: true };
      }
      const containers = await runRuntime(
        found.runtime,
        buildListArgs(),
        CONTAINER_READ_TIMEOUT_MS
      );
      const images = await runRuntime(
        found.runtime,
        buildImagesArgs(),
        CONTAINER_READ_TIMEOUT_MS
      );
      const parts = [
        'Containers:',
        formatResult(containers),
        'Images:',
        formatResult(images)
      ];
      const text = parts.join('\n').trim();
      if (containers.code !== 0 || images.code !== 0) {
        return {
          content: truncateContainerOutput(text),
          isError: true
        };
      }
      return { content: truncateContainerOutput(text) };
    }
  };

  const logs: ToolEntry = {
    name: 'container_logs',
    description:
      'Read the logs of a container of the container runtime of the machine (podman or docker). The tool only reads the logs, it does not change the container.',
    approval: 'never',
    sideEffect: false,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the container.'
        },
        tail: {
          type: 'integer',
          minimum: 1,
          maximum: 10_000,
          description: 'How many lines of the log to read, default 100.'
        }
      },
      required: ['name']
    },
    async execute(input) {
      const name = String(input['name'] ?? '').trim();
      if (!isValidContainerName(name)) {
        return {
          content:
            'container_logs failed: the name of the container is empty or it looks like an option',
          isError: true
        };
      }
      const tail = Math.min(
        10_000,
        Math.max(1, Math.trunc(Number(input['tail'] ?? 100)) || 100)
      );
      const found = await requireRuntime();
      if ('error' in found) {
        return { content: 'container_logs failed: ' + found.error, isError: true };
      }
      const result = await runRuntime(
        found.runtime,
        buildLogsArgs(name, tail),
        CONTAINER_READ_TIMEOUT_MS
      );
      const text = formatResult(result);
      if (result.code !== 0) {
        return {
          content:
            truncateContainerOutput(
              'Command failed with exit code ' + result.code + '\n' + text
            ),
          isError: true
        };
      }
      return { content: truncateContainerOutput(text.length > 0 ? text : '[no output]') };
    }
  };

  const run: ToolEntry = {
    name: 'container_run',
    description:
      'Run a container from an image of the container runtime of the machine (podman or docker). The container runs in the background by default, its name and its command are optional. The tool starts a container, so it asks for the confirmation of the user.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'The image to run, with its tag if the tag matters.'
        },
        name: {
          type: 'string',
          description: 'The name of the new container. It cannot start with a dash.'
        },
        command: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The arguments of the command of the container, as an array of strings. The command is not run through a shell.'
        },
        detach: {
          type: 'boolean',
          description: 'Runs the container in the background, default true.'
        }
      },
      required: ['image']
    },
    async execute(input) {
      const image = String(input['image'] ?? '').trim();
      if (!isValidContainerImage(image)) {
        return {
          content: 'container_run failed: the image is empty or it looks like an option',
          isError: true
        };
      }
      const name = input['name'] === undefined ? undefined : String(input['name']).trim();
      if (name !== undefined && name.length > 0 && !isValidContainerName(name)) {
        return {
          content:
            'container_run failed: the name of the container is empty or it looks like an option',
          isError: true
        };
      }
      const command = parseCommandArg(input['command']);
      const found = await requireRuntime();
      if ('error' in found) {
        return { content: 'container_run failed: ' + found.error, isError: true };
      }
      const result = await runRuntime(
        found.runtime,
        buildRunArgs({
          image,
          name: name !== undefined && name.length > 0 ? name : undefined,
          command,
          detach: input['detach'] !== false
        }),
        CONTAINER_RUN_TIMEOUT_MS
      );
      const text = formatResult(result);
      if (result.code !== 0) {
        return {
          content:
            truncateContainerOutput(
              'Command failed with exit code ' + result.code + '\n' + text
            ),
          isError: true
        };
      }
      return { content: truncateContainerOutput(text.length > 0 ? text : '[no output]') };
    }
  };

  const stop: ToolEntry = {
    name: 'container_stop',
    description:
      'Stop a running container of the container runtime of the machine (podman or docker). The tool stops the container, so it asks for the confirmation of the user.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the container.'
        }
      },
      required: ['name']
    },
    async execute(input) {
      const name = String(input['name'] ?? '').trim();
      if (!isValidContainerName(name)) {
        return {
          content:
            'container_stop failed: the name of the container is empty or it looks like an option',
          isError: true
        };
      }
      const found = await requireRuntime();
      if ('error' in found) {
        return { content: 'container_stop failed: ' + found.error, isError: true };
      }
      const result = await runRuntime(
        found.runtime,
        buildStopArgs(name),
        CONTAINER_RUN_TIMEOUT_MS
      );
      const text = formatResult(result);
      if (result.code !== 0) {
        return {
          content:
            truncateContainerOutput(
              'Command failed with exit code ' + result.code + '\n' + text
            ),
          isError: true
        };
      }
      return { content: truncateContainerOutput(text.length > 0 ? text : '[no output]') };
    }
  };

  const exec: ToolEntry = {
    name: 'container_exec',
    description:
      'Run a command inside a running container of the container runtime of the machine (podman or docker). The command is given as an array of the arguments and is not run through a shell. The tool changes the state of the container, so it asks for the confirmation of the user.',
    approval: 'always',
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the container.'
        },
        command: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The arguments of the command, as an array of strings. A single string is split by spaces. The command is not run through a shell.'
        }
      },
      required: ['name', 'command']
    },
    async execute(input) {
      const name = String(input['name'] ?? '').trim();
      if (!isValidContainerName(name)) {
        return {
          content:
            'container_exec failed: the name of the container is empty or it looks like an option',
          isError: true
        };
      }
      const command = parseCommandArg(input['command']);
      if (command.length === 0) {
        return {
          content: 'container_exec failed: the command is empty',
          isError: true
        };
      }
      const found = await requireRuntime();
      if ('error' in found) {
        return { content: 'container_exec failed: ' + found.error, isError: true };
      }
      const result = await runRuntime(
        found.runtime,
        buildExecArgs(name, command),
        CONTAINER_RUN_TIMEOUT_MS
      );
      const text = formatResult(result);
      if (result.code !== 0) {
        return {
          content:
            truncateContainerOutput(
              'Command failed with exit code ' + result.code + '\n' + text
            ),
          isError: true
        };
      }
      return { content: truncateContainerOutput(text.length > 0 ? text : '[no output]') };
    }
  };

  return [list, logs, run, stop, exec];
}
