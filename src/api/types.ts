export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicThinkingBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: AnthropicRole;
  content: AnthropicContentBlock[];
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'stop_sequence'
  | 'max_iterations'
  | 'goal_limit';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  // MiniMax reports the cached part of the context separately.
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatRequest {
  model: string;
  maxTokens: number;
  system: string;
  messages: AnthropicMessage[];
  tools?: ToolDefinition[];
  effort?: EffortLevel;
  thinking?: 'adaptive';
  signal?: AbortSignal;
}

export type StreamEvent =
  | { type: 'message_start'; usage: Usage }
  | { type: 'thinking_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; partialJson: string }
  // The server failed in the middle of the answer. The request is repeated,
  // the piece that came goes away.
  | { type: 'stream_error'; message: string }
  | {
      type: 'message_stop';
      stopReason: StopReason;
      usage: Usage;
      blocks: AnthropicContentBlock[];
    };
