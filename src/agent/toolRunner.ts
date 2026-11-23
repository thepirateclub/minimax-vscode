import type { Usage } from '../api/types';
import type { ToolRegistry } from '../tools/registry';
import { buildPreview } from '../tools/preview';
import type { DiffPreview } from '../ui/approvals';

// The helpers of the calls of the tools: the guard of the identical calls
// and the preview of a change.
export const MAX_IDENTICAL_CALLS = 3;

export function signatureOf(name: string, input: Record<string, unknown>): string {
  return name + ':' + JSON.stringify(input);
}

export function forgetReadCalls(counts: Map<string, number>, registry: ToolRegistry): void {
  const writePrefixes = registry
    .list()
    .filter((entry) => entry.sideEffect)
    .map((entry) => entry.name + ':');
  for (const key of [...counts.keys()]) {
    if (!writePrefixes.some((prefix) => key.startsWith(prefix))) {
      counts.delete(key);
    }
  }
}

export function addUsage(total: Usage, part: Usage): Usage {
  return {
    inputTokens: total.inputTokens + part.inputTokens,
    outputTokens: total.outputTokens + part.outputTokens,
    cacheReadTokens: (total.cacheReadTokens ?? 0) + (part.cacheReadTokens ?? 0),
    cacheCreationTokens: (total.cacheCreationTokens ?? 0) + (part.cacheCreationTokens ?? 0)
  };
}

// The change of a file, it is taken before the write. A path outside of the
// workspace throws inside the preview, the action still runs.
export async function previewOf(
  workspaceRoot: string,
  name: string,
  input: Record<string, unknown>
): Promise<DiffPreview | undefined> {
  try {
    return await buildPreview(name, input, workspaceRoot);
  } catch {
    return undefined;
  }
}
