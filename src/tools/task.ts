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

// The fields that carry the payload of the action. The journal names the
// target of the action, the payload of it does not belong there.
const PAYLOAD_FIELDS = ['content', 'new_string', 'old_string', 'text', 'prompt'];

// The arguments of a tool as a short line for the journal of the card. The
// line names the target of the action and not its payload: the content of a
// file is not a line of the journal.
export function describeInput(input: Record<string, unknown>): string {
  const path = input['path'];
  let target = typeof path === 'string' ? path.trim() : '';
  if (target.length === 0) {
    for (const [key, value] of Object.entries(input)) {
      if (PAYLOAD_FIELDS.includes(key)) {
        continue;
      }
      if (typeof value === 'string' && value.trim().length > 0) {
        target = value.trim();
        break;
      }
    }
  }
  if (target.length === 0) {
    return '';
  }
  return target.length > 60 ? target.slice(0, 60) + '…' : target;
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
      const rawPrompt = input['prompt'];
      // The server does not check the schema of the tool, the tool checks
      // its own input.
      if (rawPrompt !== undefined && typeof rawPrompt !== 'string') {
        return {
          content: 'The prompt of the task has to be a text.',
          isError: true
        };
      }
      const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
      if (prompt.length === 0) {
        return {
          content: 'The task has no prompt, the sub-agent has nothing to do.',
          isError: true
        };
      }
      // The role comes trimmed, an empty role is the role explore.
      const role = String(input['role'] ?? '').trim() || 'explore';
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
