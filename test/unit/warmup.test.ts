import { describe, expect, it, vi } from 'vitest';

const started: string[] = [];
vi.mock('../../src/host/mcp', () => ({ startMcp: async () => void started.push('mcp') }));
vi.mock('../../src/host/commands', () => ({ prepareIndex: async () => void started.push('index') }));
const { isWarm, restartMcpIfWarm, warmUp } = await import('../../src/host/warmup');

describe('the start of the index and the servers', () => {
  it('waits for the panel or the first turn and happens once', () => {
    const host = {} as never;
    restartMcpIfWarm(host);
    expect(started).toEqual([]);
    expect(isWarm(host)).toBe(false);
    warmUp(host);
    warmUp(host);
    expect(started).toEqual(['mcp', 'index']);
    restartMcpIfWarm(host);
    expect(started).toEqual(['mcp', 'index', 'mcp']);
  });
});
