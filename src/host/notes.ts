import { join } from 'node:path';
import type { MiniMaxController } from '../extension';
import { AGENT_DIR, openNotes, type Notes } from '../notes/sqlite';

// The notes of a workspace folder, opened once: .minimax/agent/notes.sqlite.
// A failure to open leaves the agent without notes, the turn goes on.
export async function notesFor(host: MiniMaxController, root: string): Promise<Notes | undefined> {
  if (!root) {
    return undefined;
  }
  let store = host.notes.get(root);
  if (!store) {
    store = openNotes(join(root, AGENT_DIR));
    host.notes.set(root, store);
    void store.then(
      (notes) => host.logger.info('the notes of the agent are in ' + notes.kind),
      (error: unknown) => {
        host.notes.delete(root);
        host.logger.error('the notes of the agent did not open', error);
      }
    );
  }
  return await store.catch(() => undefined);
}
