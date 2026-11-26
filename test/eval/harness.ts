import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Agent, type AgentEvent, type AgentRunResult } from '../../src/agent/agent';
import type { AgentOptions } from '../../src/agent/types';
import type { ToolEntry } from '../../src/tools/types';
import type { MiniMaxClient } from '../../src/api/client';
import type { AnthropicMessage, ChatRequest, StreamEvent } from '../../src/api/types';
import type { AgentMode } from '../../src/config/models';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createFileTools } from '../../src/tools/fs';
import { createGrepTools } from '../../src/tools/grep';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate, type ApprovalRequest } from '../../src/ui/approvals';

// One answer of the scripted model. A step sees the request, so the script
// reacts to what the agent sent back (an error, a refusal, a notice), as a
// real model would, instead of replaying blind.
export type Step = (request: ChatRequest) => StreamEvent[];

export interface Call {
  name: string;
  input: Record<string, unknown>;
}

let nextId = 0;

function stop(blocks: Extract<StreamEvent, { type: 'message_stop' }>['blocks'], reason: 'end_turn' | 'tool_use'): StreamEvent {
  return { type: 'message_stop', stopReason: reason, usage: { inputTokens: 10, outputTokens: 5 }, blocks };
}

export function say(text: string): Step {
  return () => [{ type: 'text_delta', text }, stop([{ type: 'text', text }], 'end_turn')];
}

export function call(...calls: Call[]): Step {
  return () => {
    const blocks = calls.map((one) => ({ type: 'tool_use' as const, id: `toolu_eval_${++nextId}`, name: one.name, input: one.input }));
    return [...blocks.map((block) => ({ type: 'tool_use_start' as const, id: block.id, name: block.name })), stop(blocks, 'tool_use')];
  };
}

export class ScriptedModel implements MiniMaxClient {
  readonly requests: ChatRequest[] = [];
  private index = 0;

  constructor(private readonly steps: Step[]) {}

  async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(request);
    const step = this.steps[this.index++];
    if (!step) {
      throw new Error('the script of the model has no answer left');
    }
    yield* step(request);
  }
}

// The last tool result the agent sent to the model, the script reads it.
export function lastResult(request: ChatRequest): { content: string; isError: boolean } | undefined {
  const last: AnthropicMessage | undefined = request.messages[request.messages.length - 1];
  const block = last?.content.find((one) => one.type === 'tool_result');
  if (!block || block.type !== 'tool_result') {
    return undefined;
  }
  const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
  return { content, isError: block.is_error === true };
}

export interface Scenario {
  files: Record<string, string>;
  steps: Step[];
  prompt: string;
  mode?: AgentMode;
  // Approvals answered no, by default every approval is yes.
  deny?: boolean;
  maxIterations?: number;
  // The options of the agent beyond the defaults: the fallback model, the
  // retries.
  options?: Partial<AgentOptions>;
  // The tools of the scenario next to the file tools, a sub-agent stub.
  tools?: ToolEntry[];
}

export interface ToolRecord {
  name: string;
  input: Record<string, unknown>;
  isError: boolean;
  content: string;
}

export interface Trace {
  result: AgentRunResult;
  events: AgentEvent[];
  tools: ToolRecord[];
  approvals: ApprovalRequest[];
  model: ScriptedModel;
  file(path: string): string | undefined;
}

// Runs one scenario on a temporary workspace with the real file tools and
// returns everything the checks look at. The workspace is removed after.
export async function runScenario(scenario: Scenario): Promise<Trace> {
  const root = mkdtempSync(join(tmpdir(), 'mm-eval-'));
  try {
    for (const [path, content] of Object.entries(scenario.files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    const registry = new ToolRegistry();
    for (const entry of [...createFileTools({ backups: new InMemoryBackupStore() }), ...createGrepTools(), ...(scenario.tools ?? [])]) {
      registry.register(entry);
    }
    const events: AgentEvent[] = [];
    const approvals: ApprovalRequest[] = [];
    const model = new ScriptedModel(scenario.steps);
    const agent = new Agent({
      client: model,
      registry,
      approval: new ApprovalGate({
        autoApprove: [],
        request: async (request) => {
          approvals.push(request);
          return { approved: !scenario.deny, allowForSession: false };
        }
      }),
      model: 'MiniMax-M3.1-Flash',
      maxTokens: 32000,
      maxIterations: scenario.maxIterations ?? 10,
      effort: 'max',
      mode: scenario.mode ?? 'code',
      systemPrompt: 'system',
      workspaceRoot: root,
      logger: { info: () => undefined, error: () => undefined },
      onEvent: (event) => events.push(event),
      ...scenario.options
    });
    const result = await agent.run(scenario.prompt, []);
    const files: Record<string, string | undefined> = {};
    for (const path of Object.keys(scenario.files)) {
      try {
        files[path] = readFileSync(join(root, path), 'utf8');
      } catch {
        files[path] = undefined;
      }
    }
    return { result, events, tools: toolRecords(events), approvals, model, file: (path) => files[path] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function toolRecords(events: AgentEvent[]): ToolRecord[] {
  const records: ToolRecord[] = [];
  const open = new Map<string, ToolRecord>();
  for (const event of events) {
    if (event.type === 'tool_start') {
      const record = { name: event.name, input: event.input, isError: false, content: '' };
      open.set(event.id, record);
      records.push(record);
    } else if (event.type === 'tool_end') {
      const record = open.get(event.id);
      if (record) {
        record.isError = event.isError === true;
        record.content = typeof event.content === 'string' ? event.content : JSON.stringify(event.content);
      }
    }
  }
  return records;
}
