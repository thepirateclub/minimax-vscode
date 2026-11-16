import { describe, expect, it } from 'vitest';
import {
  buildExecArgs,
  buildImagesArgs,
  buildListArgs,
  buildLogsArgs,
  buildRunArgs,
  buildStopArgs,
  createContainerTools,
  isValidContainerImage,
  isValidContainerName,
  parseCommandArg,
  pickContainerRuntime
} from '../../src/tools/containers';

describe('containers', () => {
  it('builds the arguments of the list of the containers and the images', () => {
    expect(buildListArgs()[0]).toBe('ps');
    expect(buildListArgs()).toContain('--all');
    expect(buildImagesArgs()[0]).toBe('images');
  });

  it('builds the arguments of the logs with the tail', () => {
    expect(buildLogsArgs('web', 100)).toEqual(['logs', '--tail', '100', 'web']);
  });

  it('builds the arguments of the run', () => {
    expect(buildRunArgs({ image: 'nginx' })).toEqual(['run', '--detach', 'nginx']);
    expect(
      buildRunArgs({
        image: 'nginx',
        name: 'web',
        command: ['nginx', '-g', 'daemon off;'],
        detach: false
      })
    ).toEqual(['run', '--name', 'web', 'nginx', 'nginx', '-g', 'daemon off;']);
  });

  it('builds the arguments of the stop and the exec', () => {
    expect(buildStopArgs('web')).toEqual(['stop', 'web']);
    expect(buildExecArgs('web', ['ls', '-l'])).toEqual(['exec', 'web', 'ls', '-l']);
  });

  it('does not take a command with a shell', () => {
    expect(parseCommandArg(['ls', '-l'])).toEqual(['ls', '-l']);
    expect(parseCommandArg('ls -l')).toEqual(['ls', '-l']);
    expect(parseCommandArg(undefined)).toEqual([]);
  });

  it('refuses a name that looks like an option', () => {
    expect(isValidContainerName('web')).toBe(true);
    expect(isValidContainerName('-web')).toBe(false);
    expect(isValidContainerName('')).toBe(false);
    expect(isValidContainerName('web 1')).toBe(false);
    expect(isValidContainerImage('nginx:latest')).toBe(true);
    expect(isValidContainerImage('--rm')).toBe(false);
  });

  it('prefers podman and falls back to docker', async () => {
    const podman = await pickContainerRuntime(['podman', 'docker'], () => true);
    expect(podman).toBe('podman');

    const docker = await pickContainerRuntime(
      ['podman', 'docker'],
      (runtime) => runtime === 'docker'
    );
    expect(docker).toBe('docker');

    const none = await pickContainerRuntime(['podman', 'docker'], () => false);
    expect(none).toBeUndefined();
  });

  it('refuses a container name that starts with a dash', async () => {
    const tool = createContainerTools().find((entry) => entry.name === 'container_stop');
    const result = await tool!.execute(
      { name: '--rm' },
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        logger: { info: () => undefined, error: () => undefined }
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('option');
  });

  it('refuses an empty command of the exec', async () => {
    const tool = createContainerTools().find((entry) => entry.name === 'container_exec');
    const result = await tool!.execute(
      { name: 'web', command: [] },
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        logger: { info: () => undefined, error: () => undefined }
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('the command is empty');
  });

  it('marks the tools that change the runtime', () => {
    const tools = createContainerTools();
    expect(tools.map((entry) => entry.name)).toEqual([
      'container_list',
      'container_logs',
      'container_run',
      'container_stop',
      'container_exec'
    ]);
    const byName = new Map(tools.map((entry) => [entry.name, entry]));
    expect(byName.get('container_list')!.approval).toBe('never');
    expect(byName.get('container_list')!.sideEffect).toBe(false);
    expect(byName.get('container_logs')!.approval).toBe('never');
    expect(byName.get('container_run')!.approval).toBe('always');
    expect(byName.get('container_run')!.sideEffect).toBe(true);
    expect(byName.get('container_stop')!.approval).toBe('always');
    expect(byName.get('container_exec')!.approval).toBe('always');
  });
});
