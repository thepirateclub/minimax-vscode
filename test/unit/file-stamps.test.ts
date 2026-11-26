import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryBackupStore } from '../../src/storage/backups';
import { createFileTools, EXTERNAL_EDIT_NOTE } from '../../src/tools/fs';
import type { ToolContext, ToolEntry } from '../../src/tools/types';

function setup(): { root: string; tools: Map<string, ToolEntry>; ctx: ToolContext } {
  const root = mkdtempSync(join(tmpdir(), 'stamps-'));
  const tools = new Map(createFileTools({ backups: new InMemoryBackupStore() }).map((tool) => [tool.name, tool]));
  const ctx = { workspaceRoot: root, signal: new AbortController().signal, logger: console, sessionId: 's' + Math.random() } as unknown as ToolContext;
  return { root, tools, ctx };
}

describe('the change of a file outside the agent', () => {
  it('refuses a whole write over the change of the reader', async () => {
    const { root, tools, ctx } = setup();
    writeFileSync(join(root, 'a.ts'), 'one');
    await tools.get('read_file')!.execute({ path: 'a.ts' }, ctx);
    writeFileSync(join(root, 'a.ts'), 'one and the work of the reader');
    const result = await tools.get('write_file')!.execute({ path: 'a.ts', content: 'two' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('changed outside the agent');
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('one and the work of the reader');
    // After a fresh read the write goes through.
    await tools.get('read_file')!.execute({ path: 'a.ts' }, ctx);
    expect((await tools.get('write_file')!.execute({ path: 'a.ts', content: 'two' }, ctx)).isError).toBe(false);
  });

  it('lets its own writes follow each other and names a stale edit', async () => {
    const { root, tools, ctx } = setup();
    expect((await tools.get('write_file')!.execute({ path: 'b.ts', content: 'a\nb' }, ctx)).isError).toBe(false);
    expect((await tools.get('write_file')!.execute({ path: 'b.ts', content: 'a\nc' }, ctx)).isError).toBe(false);
    writeFileSync(join(root, 'b.ts'), 'a\nc\nd');
    const edit = await tools.get('edit_file')!.execute({ path: 'b.ts', old_string: 'a', new_string: 'z' }, ctx);
    expect(edit.isError).toBe(false);
    expect(edit.content).toContain(EXTERNAL_EDIT_NOTE);
  });

  it('writes over a file the agent never saw', async () => {
    const { root, tools, ctx } = setup();
    writeFileSync(join(root, 'c.ts'), 'old');
    expect((await tools.get('write_file')!.execute({ path: 'c.ts', content: 'new' }, ctx)).isError).toBe(false);
  });
});
