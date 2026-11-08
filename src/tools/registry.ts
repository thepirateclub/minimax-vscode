import type { ToolDefinition } from '../api/types';
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

  toAnthropicTools(): ToolDefinition[] {
    return this.list().map((entry) => ({
      name: entry.name,
      description: entry.description,
      input_schema: entry.inputSchema
    }));
  }
}
