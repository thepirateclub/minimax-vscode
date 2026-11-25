// The pair of a planner and an executor, the way Aider splits the architect
// and the editor: a stronger model writes the plan of the change in one
// request without tools, the model of the chat does the work with the plan
// in its request. The pair is off by default: it costs one more request a
// turn and pays only when the measure on the tasks of the project says so.

import type { MiniMaxClient } from '../api/client';
import type { AnthropicMessage, EffortLevel, Usage } from '../api/types';

export const PLANNER_PROMPT = [
  'You are the planner of a coding agent. Another model does the work: it reads the files, edits them and runs the commands.',
  'Write the plan of the change for the request below. Name the files to read and to change, the order of the steps and how to check the result (the tests, the typecheck).',
  'Do not write the code itself, keep the plan short: a numbered list of at most 10 steps.',
  'When the request is a question, not a change, answer with one line: NO PLAN.'
].join('\n');

const MAX_PLAN_TOKENS = 16_384;

export interface PlannerOptions {
  client: MiniMaxClient;
  model: string;
  // The context of the turn: the state of the repository and its map.
  context: string;
  request: string;
  effort?: EffortLevel;
  thinking?: 'adaptive';
  signal?: AbortSignal;
}

export interface PlannerResult {
  plan: string;
  usage: Usage;
}

export async function planTurn(options: PlannerOptions): Promise<PlannerResult> {
  const messages: AnthropicMessage[] = [{ role: 'user', content: [{ type: 'text', text: options.request }] }];
  let text = '';
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const request = {
    model: options.model,
    maxTokens: MAX_PLAN_TOKENS,
    system: options.context.length > 0 ? PLANNER_PROMPT + '\n\n' + options.context : PLANNER_PROMPT,
    messages,
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    ...(options.thinking !== undefined ? { thinking: options.thinking } : {})
  };
  for await (const event of options.client.stream(request, options.signal ? { signal: options.signal } : undefined)) {
    if (event.type === 'text_delta') {
      text += event.text;
    } else if (event.type === 'stream_error') {
      throw new Error(event.message);
    } else if (event.type === 'message_stop') {
      usage = event.usage;
    }
  }
  const plan = text.trim();
  return { plan: /^NO PLAN\.?$/i.test(plan) ? '' : plan, usage };
}

// The request of the executor carries the plan after the words of the
// reader: the reader asked, the plan is a help, not an order.
export function withPlan(request: string, plan: string, model: string): string {
  if (plan.length === 0) {
    return request;
  }
  return (
    request +
    '\n\nPlan from the planner model (' + model + '):\n' + plan +
    '\n\nFollow the plan. When the code shows a step is wrong, do what the code needs and say why.'
  );
}
