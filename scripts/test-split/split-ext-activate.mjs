import { readFileSync } from 'node:fs';
import { assertNotSplit, splitIts, writeFile } from './test-split-lib.mjs';

// The split of the activation is already done: a second run would write the
// cases of the first file into the other files and lose most of them.
const alreadySplit = ['test/helpers/vscodeMock.ts', 'test/helpers/extensionHarness.ts'];
for (let index = 2; index <= 15; index++) {
  alreadySplit.push('test/unit/extension-activate-' + index + '.test.ts');
}
assertNotSplit(alreadySplit);

const path = 'test/unit/extension-activate.test.ts';
const lines = readFileSync(path, 'utf8').split(/\r?\n/);

const at = (predicate, from = 0) => {
  for (let i = from; i < lines.length; i++) {
    if (predicate(lines[i], i)) {
      return i;
    }
  }
  return -1;
};

const waitAt = at((line) => line.startsWith('async function waitForState'));
const stateAt = at((line) => line.startsWith('const state = vi.hoisted('));
const hoistedEnd = at((line) => line.trim() === '}));', stateAt);
const mockAt = at((line) => line.startsWith("vi.mock('vscode'"), stateAt);
const statusAt = at((line) => line.includes('StatusBarAlignment'), mockAt);
const mockEnd = at((line) => line === '});', statusAt);
const describeAt = at((line) => line.startsWith("describe('extension activation'"));
if ([waitAt, stateAt, hoistedEnd, mockAt, mockEnd, describeAt].some((v) => v < 0)) {
  throw new Error('a boundary is not found');
}

// The mock of the editor with the state of the test.
const stateBlock = lines.slice(stateAt, hoistedEnd + 1);
stateBlock[0] = 'export const state = {';
stateBlock[stateBlock.length - 1] = '};';

const mockBlock = lines.slice(mockAt, mockEnd + 1);
mockBlock[0] = 'export function vscodeMock(): Record<string, unknown> {';
mockBlock[mockBlock.length - 1] = '}';

const mockFile = [
  "import type { ExtToWeb, WebToExt } from '../../src/ui/protocol';",
  '',
  ...stateBlock,
  '',
  ...mockBlock,
  ''
];
writeFile('test/helpers/vscodeMock.ts', mockFile);

// The rest of the tools of the test.
const headHelpers = lines.slice(waitAt, stateAt);
const tailHelpers = lines.slice(mockEnd + 1, describeAt);
const harnessFile = [
  "import { execFile } from 'node:child_process';",
  "import { promisify } from 'node:util';",
  "import { expect, vi } from 'vitest';",
  "import type { ExtensionContext } from 'vscode';",
  "import type { ExtToWeb, WebToExt } from '../../src/ui/protocol';",
  "import { state } from './vscodeMock';",
  '',
  ...headHelpers.map((line) =>
    line.startsWith('interface FetchLog') || line.startsWith('async function waitForState')
      ? 'export ' + line
      : line
  ),
  ...tailHelpers.map((line) =>
    /^(function |const |async function )/.test(line) ? 'export ' + line : line
  )
];
writeFile('test/helpers/extensionHarness.ts', harnessFile);

// The cases of the file, grouped by the size of the file.
const body = lines.slice(describeAt);
const its = splitIts(body);
console.log('cases: ' + its.length);

const beforeEach = body
  .slice(0, body.findIndex((line) => line.startsWith('  it(')))
  .filter((line) => line !== "describe('extension activation', () => {");

const groups = [];
let group = [];
let size = 0;
for (const item of its) {
  const linesOfCase = item.split('\n').length;
  if (group.length > 0 && size + linesOfCase > 210) {
    groups.push(group);
    group = [];
    size = 0;
  }
  group.push(item);
  size += linesOfCase + 1;
}
groups.push(group);

const helperNames = [
  'waitForState', 'MESSAGES_URL', 'PROBE_MARK', 'PROBE_SSE', 'QUOTA_JSON',
  'TEXT_SSE', 'TOOL_SSE', 'TODO_SSE', 'GOAL_SSE', 'taskSse', 'writeSse',
  'CHILD_TEXT_SSE', 'makeContext', 'makeView', 'stubFetch', 'boot', 'types',
  'ofType', 'runGit'
];

groups.forEach((items, index) => {
  const inner = items.join('\n\n');
  const scan = inner + '\n' + beforeEach.join('\n');
  const used = helperNames.filter((name) =>
    new RegExp('(^|[^A-Za-z0-9_$])' + name + '([^A-Za-z0-9_$]|$)').test(scan)
  );
  const needsProtocol = /ExtToWeb|WebToExt/.test(scan);
  const fsNames = ['mkdtemp', 'readFile', 'writeFile'];
  const fsUsed = fsNames.filter((name) =>
    new RegExp('(^|[^A-Za-z0-9_$])' + name + '\\(').test(scan)
  );
  const needsTmp = /tmpdir\(/.test(scan);
  const needsJoin = /[^A-Za-z0-9_$]join\(/.test(scan);
  const needsExec = /execFile\(|promisify\(/.test(scan);
  const head = [
    "import { beforeEach, describe, expect, it, vi } from 'vitest';",
    ...(fsUsed.length > 0 || needsTmp || needsJoin
      ? [
          ...(fsUsed.length > 0
            ? ["import { " + fsUsed.join(', ') + " } from 'node:fs/promises';"]
            : []),
          ...(needsTmp ? ["import { tmpdir } from 'node:os';"] : []),
          ...(needsJoin ? ["import { join } from 'node:path';"] : [])
        ]
      : []),
    ...(needsExec
      ? ["import { execFile } from 'node:child_process';", "import { promisify } from 'node:util';"]
      : []),
    ...(needsProtocol
      ? ["import type { ExtToWeb, WebToExt } from '../../src/ui/protocol';"]
      : []),
    "import { state } from '../helpers/vscodeMock';",
    "import { " + used.join(', ') + " } from '../helpers/extensionHarness';",
    '',
    "vi.mock('vscode', async () => (await import('../helpers/vscodeMock')).vscodeMock());",
    ''
  ];
  const content = [
    "describe('extension activation', () => {",
    ...beforeEach,
    inner,
    '});'
  ].join('\n');
  const name =
    index === 0
      ? 'test/unit/extension-activate.test.ts'
      : 'test/unit/extension-activate-' + (index + 1) + '.test.ts';
  writeFile(name, [...head, content]);
});
