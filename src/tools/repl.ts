import type { ToolEntry } from './types';
import { executeRepl } from './repl/processes';
import { REPL_MAX_TIMEOUT_MS, REPL_MIN_TIMEOUT_MS } from './repl/protocol';

export * from './repl/protocol';
export { executeRepl, resetReplProcesses, stopReplSession } from './repl/processes';

export function createReplTools(): ToolEntry[] {
  const node: ToolEntry = {
    name: 'repl_node',
    description:
      'Run JavaScript in a persistent Node.js REPL that belongs to this chat. The process stays alive between the calls, so the variables, the functions and the imports of the previous call are still there. The code runs in the workspace root. Use it to try an idea quickly, to look at the data of the project or to keep a state between the steps of the work. The tool returns the output of the code and the value of the last expression. Top-level await works, a promise on the last line is awaited, and a block may declare the same const or let again.',
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
