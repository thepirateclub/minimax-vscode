import type { Usage } from '../api/types';
import type { ToolContext, ToolEntry } from './types';

export type TaskRole = 'explore' | 'worker' | 'verifier';

const ROLES: TaskRole[] = ['explore', 'worker', 'verifier'];

// The child does not run forever, the turn of the parent is long enough
// on its own.
export const CHILD_MAX_ITERATIONS = 12;

export interface TaskRequest {
  description: string;
  prompt: string;
  role: TaskRole;
}

export interface TaskOutcome {
  content: string;
  isError?: boolean;
  // The spend of the child, it belongs to the action of the parent.
  usage?: Usage;
}

export interface TaskOptions {
  // The host starts the child, the tool only asks for it.
  spawn: (
    request: TaskRequest,
    ctx: ToolContext,
    progress: (line: string) => void
  ) => Promise<TaskOutcome>;
}

// The arguments of a tool as a short line for the journal of the card.
export function describeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const value of Object.values(input)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      const text = value.trim();
      parts.push(text.length > 60 ? text.slice(0, 60) + '…' : text);
    }
  }
  return parts.join(' ');
}

export function createTaskTools(options: TaskOptions): ToolEntry[] {
  const task: ToolEntry = {
    name: 'task',
    description:
      'Start a sub-agent that works on its own and answers with a report. Use it for a piece of work that needs its own context: exploring the project, making a change or checking the work of somebody. The answer of the sub-agent is the result of this call. The role "explore" only reads, "worker" changes files, "verifier" checks the work.',
    approval: 'never',
    // The child can change files, the tool is not available in plan mode.
    sideEffect: true,
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'A short name of the task, one line.'
        },
        prompt: {
          type: 'string',
          description: 'The task for the sub-agent, with every detail it needs.'
        },
        role: {
          type: 'string',
          enum: ['explore', 'worker', 'verifier'],
          description:
            'What the sub-agent is allowed to do. "explore" reads, "worker" changes files, "verifier" checks the work.'
        }
      },
      required: ['description', 'prompt']
    },
    async execute(input, ctx) {
      // One level of sub-agents, the depth of the agent stops the rest.
      if ((ctx.depth ?? 0) > 0) {
        return {
          content: 'A sub-agent cannot start another sub-agent.',
          isError: true
        };
      }
      const description = String(input['description'] ?? '').trim();
      const prompt = String(input['prompt'] ?? '').trim();
      const role = String(input['role'] ?? 'explore');
      if (prompt.length === 0) {
        return {
          content: 'The task has no prompt, the sub-agent has nothing to do.',
          isError: true
        };
      }
      if (!ROLES.includes(role as TaskRole)) {
        return {
          content:
            'The role of the task is "explore", "worker" or "verifier", not "' +
            role +
            '".',
          isError: true
        };
      }
      const outcome = await options.spawn(
        { description, prompt, role: role as TaskRole },
        ctx,
        (line) => ctx.progress?.(line)
      );
      // A call that worked carries no flag of an error at all.
      return {
        content: outcome.content,
        isError: outcome.isError === true ? true : undefined,
        usage: outcome.usage
      };
    }
  };
  return [task];
}
