import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorkspaceSnapshot, renderSnapshot } from '../../src/agent/context';
import { buildSystemPrompt } from '../../src/agent/prompt';

describe('buildWorkspaceSnapshot', () => {
  it('reads project rule files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'AGENTS.md'), 'always be careful', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    expect(snapshot.rules[0]?.path).toBe('AGENTS.md');
    expect(snapshot.rules[0]?.content).toContain('always be careful');
  });

  it('detects the stack from manifests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'package.json'), '{"name":"demo"}', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    expect(snapshot.stack).toContain('package.json');
  });

  it('skips ignored directories in the tree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'node_modules', 'x.js'), 'x', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    expect(snapshot.tree.join('\n')).not.toContain('node_modules');
  });
});

describe('renderSnapshot', () => {
  it('renders rules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mm-'));
    await writeFile(join(root, 'AGENTS.md'), 'rule text', 'utf8');
    const snapshot = await buildWorkspaceSnapshot(root, { includeOpenFiles: false });
    expect(renderSnapshot(snapshot)).toContain('rule text');
  });
});

describe('buildSystemPrompt', () => {
  it('mentions the tool protocol and the environment', () => {
    const prompt = buildSystemPrompt({
      workspaceRoot: '/tmp/demo',
      os: 'win32',
      shell: 'powershell',
      rulesText: 'rules here',
      treeText: 'src/',
      stackText: 'package.json',
      openFilesText: 'src/a.ts'
    });
    expect(prompt).toContain('read_file');
    expect(prompt).toContain('/tmp/demo');
    expect(prompt).toContain('rules here');
  });
});
