import { afterAll, describe, expect, it } from 'vitest';
import { createReplTools, stopReplSession } from '../../src/tools/repl';

const SESSION = 'repl-live-' + process.pid;
const ctx = {
  workspaceRoot: process.cwd(),
  signal: new AbortController().signal,
  logger: { info: () => undefined, error: () => undefined },
  sessionId: SESSION
};

function tool(name: 'repl_node' | 'repl_python') {
  const found = createReplTools().find((item) => item.name === name);
  if (!found) {
    throw new Error('no tool ' + name);
  }
  return (code: string) => found.execute({ code }, ctx);
}

afterAll(() => stopReplSession(SESSION));

// The agent works in the REPL like a person: it awaits a promise, runs a
// block again with the same names, and sees the warnings of the code.
describe('the Node REPL', () => {
  const run = tool('repl_node');

  it('awaits at the top level and shows the value of the promise', async () => {
    expect((await run('const v = await Promise.resolve(41); v + 1')).content).toBe('42');
    expect((await run('Promise.resolve("done")')).content).toBe('done');
  });

  it('keeps a name declared in an async block for the next block', async () => {
    await run('const fromAsync = await Promise.resolve(7)');
    expect((await run('fromAsync * 2')).content).toBe('14');
  });

  it('runs a block again with the same const and let', async () => {
    await run('const again = 1;\nlet other = 2;');
    const result = await run('const again = 3;\nlet other = 4;\nagain + other');
    expect(result).toEqual({ content: '7', isError: false });
  });

  it('names a rejected promise as an error', async () => {
    const result = await run('await Promise.reject(new Error("nope"))');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('nope');
  });
});

describe('the Python REPL', () => {
  const run = tool('repl_python');

  it('shows what the code writes to stderr', async () => {
    const result = await run('import sys\nsys.stderr.write("careful\\n")\nprint("ok")');
    expect(result.content).toContain('ok');
    expect(result.content).toContain('[stderr] careful');
  });

  it('does not hang on a large stderr', async () => {
    const result = await run('import sys\nsys.stderr.write("x" * 200000)\nprint("alive")');
    expect(result.content).toContain('alive');
  }, 20_000);
});
