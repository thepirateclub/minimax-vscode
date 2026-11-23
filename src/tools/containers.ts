import type { ToolEntry } from './types';
import { formatResult, requireRuntime, runRuntime } from './containers/runtime';
import {
  buildExecArgs,
  buildImagesArgs,
  buildListArgs,
  buildLogsArgs,
  buildRunArgs,
  buildStopArgs,
  isValidContainerImage,
  isValidContainerName,
  parseCommandArg,
  truncateContainerOutput
} from './containers/args';

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

// The helpers of the arguments stay reachable under the old name.
export * from './containers/args';
