import { Agent, type AgentEvent } from '../../src/agent/agent';
import type { MiniMaxClient } from '../../src/api/client';
import type { ChatRequest, StreamEvent } from '../../src/api/types';
import type { AgentMode } from '../../src/config/models';
import { ToolRegistry } from '../../src/tools/registry';
import { ApprovalGate, type ApprovalDecision, type ApprovalRequest } from '../../src/ui/approvals';


export class FakeClient implements MiniMaxClient {
  readonly requests: ChatRequest[] = [];
  // The number of answers that were streamed to the end.
  streamed = 0;
  private index = 0;

  constructor(private readonly responses: StreamEvent[][]) {}

  async *stream(request: ChatRequest): AsyncGenerator<StreamEvent> {
    this.requests.push(request);
    const response = this.responses[this.index];
    this.index += 1;
    if (!response) {
      throw new Error('no scripted response left');
    }
    for (const event of response) {
      yield event;
    }
    this.streamed += 1;
  }
}

export function textResponse(text: string, stopReason: 'end_turn' | 'tool_use' = 'end_turn'): StreamEvent[] {
  return [
    { type: 'text_delta', text },
    {
      type: 'message_stop',
      stopReason,
      usage: { inputTokens: 10, outputTokens: 5 },
      blocks: [{ type: 'text', text }]
    }
  ];
}

export function toolResponse(name: string, input: Record<string, unknown>): StreamEvent[] {
  const block = { type: 'tool_use' as const, id: 'toolu_1', name, input };
  return [
    { type: 'tool_use_start', id: 'toolu_1', name },
    {
      type: 'message_stop',
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5 },
      blocks: [block]
    }
  ];
}

export function makeAgent(
  client: FakeClient,
  decide: ApprovalDecision = { approved: true, allowForSession: false },
  mode: AgentMode = 'code',
  workspaceRoot = '/tmp/root',
  maxIterations = 5
): { agent: Agent; events: AgentEvent[]; requests: ApprovalRequest[] } {
  const events: AgentEvent[] = [];
  const requests: ApprovalRequest[] = [];
  const registry = new ToolRegistry();
  registry.register({
    name: 'read_file',
    description: 'read',
    approval: 'never',
    sideEffect: false,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'file content' })
  });
  registry.register({
    name: 'write_file',
    description: 'write',
    approval: 'always',
    sideEffect: true,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: 'written' })
  });
  const agent = new Agent({
    client,
    registry,
    approval: new ApprovalGate({
      autoApprove: [],
      request: async (request) => {
        requests.push(request);
        return decide;
      }
    }),
    model: 'MiniMax-M3.1-Flash',
    maxTokens: 32000,
    maxIterations,
    effort: 'max',
    mode,
    systemPrompt: 'system',
    workspaceRoot,
    logger: { info: () => undefined, error: () => undefined },
    onEvent: (event) => events.push(event)
  });
  return { agent, events, requests };
}
