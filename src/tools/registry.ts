import type { ToolDefinition } from '../api/types';
import type { AgentMode } from '../config/models';
import type { ToolEntry } from './types';

export class ToolRegistry {
  private readonly entries = new Map<string, ToolEntry>();

  register(entry: ToolEntry): void {
    this.entries.set(entry.name, entry);
  }

  list(): ToolEntry[] {
    return [...this.entries.values()];
  }

  get(name: string): ToolEntry | undefined {
    return this.entries.get(name);
  }

  // Plan mode is read-only, only code mode may use the tools with a side effect.
  isAllowed(entry: ToolEntry, mode: AgentMode): boolean {
    return mode === 'code' || !entry.sideEffect;
  }

  toAnthropicTools(mode: AgentMode = 'code'): ToolDefinition[] {
    return this.list()
      .filter((entry) => this.isAllowed(entry, mode))
      .map((entry) => ({
        name: entry.name,
        description: entry.description,
        input_schema: entry.inputSchema
      }));
  }
}
