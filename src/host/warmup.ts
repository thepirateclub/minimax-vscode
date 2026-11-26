import type { MiniMaxController } from '../extension';
import { prepareIndex } from './commands';
import { startMcp } from './mcp';

// Every window of the editor activates the extension on start for the badge
// of the quota. The index of the project and the MCP servers wait for the
// first look at the panel or the first turn: a window where nobody opens
// the agent does not walk the disk or spawn the servers.
const warm = new WeakSet<MiniMaxController>();

export function warmUp(host: MiniMaxController): void {
  if (warm.has(host)) {
    return;
  }
  warm.add(host);
  void startMcp(host);
  void prepareIndex(host);
}

export function isWarm(host: MiniMaxController): boolean {
  return warm.has(host);
}

// A change of the settings restarts the servers only when they run.
export function restartMcpIfWarm(host: MiniMaxController): void {
  if (warm.has(host)) {
    void startMcp(host);
  }
}
