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
// The input of an action of the child for the journal of the card: the
// fields that name the action stay, the payload (the content of a file, the
// text of an edit) goes, a long value is cut. The panel names the action
// from it with the same describer as a card of the parent.
const ACTION_VALUE_MAX = 200;

export function actionInput(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (PAYLOAD_FIELDS.includes(key)) {
      continue;
    }
    if (typeof value === 'string') {
      result[key] = value.slice(0, ACTION_VALUE_MAX);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    } else if (Array.isArray(value)) {
      result[key] = value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.slice(0, ACTION_VALUE_MAX));
    }
  }
  return result;
}

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

// The role of a sub-agent tells it what it may do and what its answer looks
// like. The text goes to the model, it is English.
export const ROLE_PROMPTS: Record<TaskRole, string> = {
  explore:
    'You are a sub-agent of the main agent. Your task is to explore: you read the files and you search the project, you never change anything. Answer with a short report: what you found, the paths and the facts. Your answer is the result of the task, write it as plain text.',
  worker:
    'You are a sub-agent of the main agent. Your task is to make the change: you edit the files and you run the commands. Answer with a short report: what you changed and what you checked. Your answer is the result of the task, write it as plain text.',
  verifier:
    'You are a sub-agent of the main agent. Your task is to check the work: you read the files and the changes and you look for the defects. A reading alone is not a check: find how the project runs its checks (the scripts of the manifest, the test and typecheck commands named in AGENTS.md or the README) and run the existing tests and the check of the types that cover the change, before you say the work is done. You never change the files. Answer with the list of the defects you found, or with the words that there are none, and with the commands you ran and their results. Your answer is the result of the task, write it as plain text.'
};

// The commands the verifier runs: the tests and the checks of the project.
const VERIFIER_COMMANDS = ['run_terminal', 'run_cmd'];

// The tools of a child by its role. Explore reads, the worker gets every
// tool, the verifier reads and runs the commands of the checks behind the
// same approval, it never writes. No child starts a child of its own.
export function toolAllowedForRole(
  entry: { name: string; sideEffect: boolean },
  role: TaskRole
): boolean {
  if (entry.name === 'task') {
    return false;
  }
  if (role === 'worker' || !entry.sideEffect) {
    return true;
  }
  return role === 'verifier' && VERIFIER_COMMANDS.includes(entry.name);
}

export function createTaskTools(options: TaskOptions): ToolEntry[] {
  const task: ToolEntry = {
    name: 'task',
    description:
      'Start a sub-agent that works on its own and answers with a report. Use it for a piece of work that needs its own context: exploring the project, making a change or checking the work of somebody. The answer of the sub-agent is the result of this call. The role "explore" only reads, "worker" changes files, "verifier" checks the work and runs the tests of the project.',
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
            'What the sub-agent is allowed to do. "explore" reads, "worker" changes files, "verifier" checks the work and runs the tests.'
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
