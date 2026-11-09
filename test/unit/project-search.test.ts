import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectSearch } from '../../src/search/project';

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mm-search-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, 'src', 'pay.ts'),
    'export function payInvoice() {\n  return 1;\n}\n',
    'utf8'
  );
  await writeFile(
    join(root, 'src', 'other.ts'),
    'export function other() {\n  return 2;\n}\n',
    'utf8'
  );
  return root;
}

describe('ProjectSearch', () => {
  it('finds a file by the words of the code', async () => {
    const root = await makeProject();
    const search = new ProjectSearch(root);
    const outcome = await search.search('payInvoice');
    expect(outcome.files).toBe(2);
    expect(outcome.hits[0]?.path).toBe('src/pay.ts');
    expect(outcome.hits[0]?.line).toBe(1);
    expect(outcome.hits[0]?.snippet).toContain('payInvoice');
  });

  it('keeps the search inside a subfolder', async () => {
    const root = await makeProject();
    const search = new ProjectSearch(root);
    const outcome = await search.search('payInvoice', { path: 'src' });
    expect(outcome.hits.length).toBeGreaterThan(0);
    expect(outcome.hits.every((hit) => hit.path.startsWith('src/'))).toBe(true);
  });

  it('finds nothing outside of the subfolder', async () => {
    const root = await makeProject();
    const search = new ProjectSearch(root);
    const outcome = await search.search('payInvoice', { path: 'docs' });
    expect(outcome.hits).toHaveLength(0);
  });

  it('reports that the semantic layer is off', async () => {
    const root = await makeProject();
    const search = new ProjectSearch(root);
    const outcome = await search.search('payInvoice', { mode: 'semantic' });
    expect(outcome.note).toContain('semantic layer is off');
  });

  it('mixes the semantic layer with the lexical index', async () => {
    const root = await makeProject();
    const search = new ProjectSearch(root);
    search.setSemanticProvider({
      embed: async (texts) =>
        texts.map((text) => (text.toLowerCase().includes('invoice') ? [1, 0] : [0, 1]))
    });
    const outcome = await search.search('invoice', { mode: 'hybrid' });
    expect(outcome.mode).toBe('hybrid');
    expect(outcome.hits.length).toBeGreaterThan(0);
    expect(outcome.hits[0]?.path).toBe('src/pay.ts');
    expect(outcome.hits[0]?.snippet).not.toBe('');
  });

  it('takes the new content of a file after the change', async () => {
    const root = await makeProject();
    const search = new ProjectSearch(root);
    await search.search('payInvoice');
    await writeFile(
      join(root, 'src', 'pay.ts'),
      'export function refundInvoice() {\n  return 1;\n}\n',
      'utf8'
    );
    search.invalidate('src/pay.ts');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const outcome = await search.search('refundInvoice');
    expect(outcome.hits[0]?.path).toBe('src/pay.ts');
  });
});
