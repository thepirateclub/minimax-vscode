import { isAbsolute, relative, sep } from 'node:path';

// The files the agent never reads or writes, even with the approval of the
// reader: the check of the root keeps the model inside the workspace, these
// patterns keep it away from the secrets inside it. A pattern with `!` lets
// a file through (`.env.example` is a template, not a secret).
export const DEFAULT_DENY_PATHS = [
  '**/.env',
  '**/.env.*',
  '!**/.env.example',
  '!**/.env.sample',
  '!**/.env.template',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa*',
  '**/id_ed25519*',
  '**/.ssh/**',
  '**/secrets/**',
  '**/.aws/credentials',
  '**/.npmrc',
  '**/.netrc'
];

interface Rule {
  allow: boolean;
  test: RegExp;
}

let rules: Rule[] = compile(DEFAULT_DENY_PATHS);

// The host sets the patterns of the reader at start and on every change of
// the setting. The module keeps them: the tools check a path without the
// settings of the editor.
export function setDenyPatterns(patterns: readonly string[]): void {
  rules = compile(patterns);
}

export function compile(patterns: readonly string[]): Rule[] {
  return patterns
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const allow = raw.startsWith('!');
      return { allow, test: globToRegExp(allow ? raw.slice(1) : raw) };
    });
}

// `**` crosses folders, `*` and `?` stay inside one name. A pattern without
// a slash names a file in any folder, as in .gitignore.
export function globToRegExp(glob: string): RegExp {
  const pattern = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  const anywhere = !pattern.includes('/');
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    if (char === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') {
        i++;
        out += '(?:.*/)?';
      } else {
        out += '.*';
      }
    } else if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + (anywhere ? '(?:.*/)?' : '') + out + '$', 'i');
}

// The last rule that matches decides, as in .gitignore.
export function isDeniedRelative(path: string, list: readonly Rule[] = rules): boolean {
  const normal = path.replace(/\\/g, '/').replace(/^\.\//, '');
  let denied = false;
  for (const rule of list) {
    if (rule.test.test(normal)) {
      denied = !rule.allow;
    }
  }
  return denied;
}

// A path outside the root is not the business of this check.
export function isDeniedPath(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel.length === 0 || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) {
    return false;
  }
  return isDeniedRelative(rel);
}
