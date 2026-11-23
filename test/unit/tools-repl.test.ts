import { describe, expect, it } from 'vitest';
import {
  REPL_BLOCK_END,
  REPL_ERROR_MARK,
  REPL_OUTPUT_END,
  buildReplCommand,
  buildReplRequest,
  createReplTools,
  isReplLanguage,
  parseReplPayload,
  pickInterpreter,
  resetReplProcesses,
  resolveReplTimeout,
  splitReplOutput,
  truncateReplOutput
} from '../../src/tools/repl';

describe('repl', () => {
  it('knows the two languages and nothing else', () => {
    expect(isReplLanguage('node')).toBe(true);
    expect(isReplLanguage('python')).toBe(true);
    expect(isReplLanguage('ruby')).toBe(false);
    expect(isReplLanguage(undefined)).toBe(false);
  });

  it('builds the command of the interpreter with the path to the bootstrap', () => {
    const node = buildReplCommand('node', 'C:\\tmp\\bootstrap.cjs');
    expect(node.command).toBe('node');
    expect(node.args).toEqual(['C:\\tmp\\bootstrap.cjs']);

    const python = buildReplCommand('python', 'C:\\tmp\\bootstrap.py');
    expect(python.command).toBe('python');
    // Python печатает буфер, без -u вывод ждёт конца блока.
    expect(python.args).toEqual(['-u', 'C:\\tmp\\bootstrap.py']);
  });

  it('takes the found interpreter instead of the default one', () => {
    const python = buildReplCommand('python', 'bootstrap.py', 'python3');
    expect(python.command).toBe('python3');
  });

  it('closes the block of the code with the end marker', () => {
    const request = buildReplRequest('const a = 1;');
    expect(request.endsWith('\n' + REPL_BLOCK_END + '\n')).toBe(true);
    expect(request).toContain('const a = 1;');
  });

  it('normalizes the line endings of the code', () => {
    const request = buildReplRequest('a\r\nb');
    expect(request).toBe('a\nb\n' + REPL_BLOCK_END + '\n');
  });

  it('splits the output of the block from the rest of the buffer', () => {
    const raw = 'hello\n' + REPL_OUTPUT_END + '\ntail of the next block';
    const split = splitReplOutput(raw);
    expect(split.output).toBe('hello\n');
    expect(split.remainder).toBe('\ntail of the next block');
  });

  it('keeps the whole buffer when the end of the output is not there yet', () => {
    const split = splitReplOutput('half of the answer');
    expect(split.output).toBe('');
    expect(split.remainder).toBe('half of the answer');
  });

  it('reads the error of the block apart from its output', () => {
    const payload = parseReplPayload('before the error');
    expect(payload.output).toBe('before the error');
    expect(payload.error).toBeUndefined();

    const failed = parseReplPayload(
      'printed\n' + REPL_ERROR_MARK + '\nReferenceError: x is not defined'
    );
    expect(failed.output).toBe('printed');
    expect(failed.error).toContain('ReferenceError');
  });

  it('cuts the long output with an honest marker', () => {
    const short = truncateReplOutput('short');
    expect(short).toBe('short');

    const long = truncateReplOutput('x'.repeat(50), 10);
    expect(long.startsWith('xxxxxxxxxx')).toBe(true);
    expect(long).toContain('output truncated');
    expect(long).toContain('40 characters cut');
  });

  it('keeps the timeout inside the allowed range', () => {
    expect(resolveReplTimeout(undefined)).toBe(15000);
    expect(resolveReplTimeout(5000)).toBe(5000);
    expect(resolveReplTimeout(10)).toBe(1000);
    expect(resolveReplTimeout(600000)).toBe(60000);
    expect(resolveReplTimeout('not a number')).toBe(15000);
  });

  it('takes the first interpreter that answers', async () => {
    const found = await pickInterpreter(['python', 'python3'], (candidate) => {
      return candidate === 'python3';
    });
    expect(found).toBe('python3');

    const missing = await pickInterpreter(['python'], () => false);
    expect(missing).toBeUndefined();
  });

  it('refuses an empty block of the code', async () => {
    const tool = createReplTools().find((entry) => entry.name === 'repl_node');
    const result = await tool!.execute(
      { code: '   ' },
      {
        workspaceRoot: process.cwd(),
        signal: new AbortController().signal,
        logger: { info: () => undefined, error: () => undefined }
      }
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain('the code is empty');
  });

  it('marks both tools as tools with a side effect', () => {
    const tools = createReplTools();
    expect(tools.map((entry) => entry.name)).toEqual(['repl_node', 'repl_python']);
    for (const entry of tools) {
      expect(entry.approval).toBe('always');
      expect(entry.sideEffect).toBe(true);
    }
  });
});


describe('the live REPL', () => {
  it('keeps the state of the variables between the calls', async () => {
    const node = createReplTools().find((item) => item.name === 'repl_node');
    if (!node) {
      throw new Error('no tool repl_node');
    }
    const ctx = {
      workspaceRoot: process.cwd(),
      signal: new AbortController().signal,
      logger: { info: () => undefined, error: () => undefined }
    };
    const first = await node.execute({ code: 'const value = 40 + 2; value' }, ctx);
    expect(first.isError).toBeFalsy();
    expect(first.content).toContain('42');
    // The process lives between the calls, the variable is still there.
    const second = await node.execute({ code: 'value + 1' }, ctx);
    expect(second.isError).toBeFalsy();
    expect(second.content).toContain('43');
    resetReplProcesses();
  });
});
