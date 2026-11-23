import { execFile } from 'node:child_process';
import {
  CONTAINER_PROBE_TIMEOUT_MS,
  CONTAINER_RUNTIMES,
  pickContainerRuntime,
  type ContainerResult,
  type ContainerRuntime
} from '../containers';

// The runtime of the containers: the probe of the commands, the cache of the
// answer and the calls of the runtime itself.
let runtimeCache: { at: number; runtime?: ContainerRuntime } | undefined;
const RUNTIME_CACHE_MS = 60_000;

export function resetContainerRuntimeCache(): void {
  runtimeCache = undefined;
}

export async function probeRuntime(runtime: ContainerRuntime): Promise<boolean> {
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
export async function detectRuntime(): Promise<ContainerRuntime | undefined> {
  if (runtimeCache && Date.now() - runtimeCache.at < RUNTIME_CACHE_MS) {
    return runtimeCache.runtime;
  }
  const runtime = await pickContainerRuntime(CONTAINER_RUNTIMES, probeRuntime);
  runtimeCache = { at: Date.now(), runtime };
  return runtime;
}

export async function runRuntime(
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

export function formatResult(result: ContainerResult): string {
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

export async function requireRuntime(): Promise<
  { runtime: ContainerRuntime } | { error: string }
> {
  const runtime = await detectRuntime();
  if (!runtime) {
    return { error: NO_RUNTIME_TEXT };
  }
  return { runtime };
}

