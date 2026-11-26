import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DENY_PATHS, isDeniedRelative, setDenyPatterns } from '../../src/denyPaths';
import { resolveWorkspacePath } from '../../src/paths';
import { maskSecrets, SECRET_MASK } from '../../src/tools/secrets';
import { collectTextFiles } from '../../src/search/files';

afterEach(() => setDenyPatterns(DEFAULT_DENY_PATHS));

describe('the closed paths of the project', () => {
  it('closes the secrets and lets the templates through', () => {
    expect(isDeniedRelative('.env')).toBe(true);
    expect(isDeniedRelative('app/.env.local')).toBe(true);
    expect(isDeniedRelative('app/.env.example')).toBe(false);
    expect(isDeniedRelative('certs/server.pem')).toBe(true);
    expect(isDeniedRelative('home/.ssh/config')).toBe(true);
    expect(isDeniedRelative('config/secrets/db.json')).toBe(true);
    expect(isDeniedRelative('src/environment.ts')).toBe(false);
    expect(isDeniedRelative(['src', 'keys', 'a.key'].join(String.fromCharCode(92)))).toBe(true);
  });

  it('refuses the path in every tool, the reader names the patterns', () => {
    const root = mkdtempSync(join(tmpdir(), 'deny-'));
    expect(() => resolveWorkspacePath(root, '.env')).toThrow(/minimax\.denyPaths/);
    expect(resolveWorkspacePath(root, 'src/a.ts')).toBe(join(root, 'src', 'a.ts'));
    setDenyPatterns(['private/**']);
    expect(() => resolveWorkspacePath(root, 'private/notes.md')).toThrow(/minimax\.denyPaths/);
    expect(resolveWorkspacePath(root, '.env')).toBe(join(root, '.env'));
  });

  it('keeps the closed files out of the index of the project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'deny-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1;');
    writeFileSync(join(root, 'src', 'b.pem'), 'key');
    setDenyPatterns(['**/*.pem', '**/*.ts', '!src/a.ts']);
    const files = await collectTextFiles(root);
    expect(files.map((file) => relative(root, file).split(sep).join('/'))).toEqual(['src/a.ts']);
  });
});

describe('the masked secrets', () => {
  it('masks the keys that are never code and keeps the code', () => {
    const key = 'ghp_' + 'a'.repeat(36);
    const text = 'const token = "' + key + '";\nconst aws = "AKIAABCDEFGHIJKLMNOP";\nconst name = "task-priority";';
    const { text: out, masked } = maskSecrets(text);
    expect(masked).toBe(2);
    expect(out).not.toContain(key);
    expect(out).toContain(SECRET_MASK);
    expect(out).toContain('task-priority');
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----';
    expect(maskSecrets(pem).text).toBe(SECRET_MASK);
  });
});
