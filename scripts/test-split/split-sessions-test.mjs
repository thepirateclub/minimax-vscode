import { readFileSync } from 'node:fs';
import { readImports, usedNames, writeFile } from './test-split-lib.mjs';

const path = 'test/unit/sessions-store.test.ts';
const lines = readFileSync(path, 'utf8').split(/\r?\n/);
const { imports, rest } = readImports(lines);
const firstDescribe = rest.findIndex((line) => line.startsWith('describe('));
const helpers = rest.slice(0, firstDescribe);
const body = rest.slice(firstDescribe);

const describes = [];
let current = null;
for (const line of body) {
  if (current === null) {
    if (line.startsWith('describe(')) {
      current = [line];
    }
    continue;
  }
  current.push(line);
  if (line === '});') {
    describes.push(current.join('\n'));
    current = null;
  }
}
console.log('describes: ' + describes.length);

const helperImports = usedNames(
  imports.filter((line) => !line.startsWith("import { describe, expect, it }")),
  helpers.join('\n')
);
const helperBody = helpers.map((line) =>
  /^(function |const |class )/.test(line) ? 'export ' + line : line
);
writeFile('test/helpers/sessionsFixture.ts', [...helperImports, '', ...helperBody]);

const helperNames = ['FakeStorage', 'userMessage', 'assistantMessage', 'uiMessage', 'session'];

const outputs = [
  { path: 'test/unit/sessions-store.test.ts', take: [describes[0], describes[1]] },
  { path: 'test/unit/sessions-store-class.test.ts', take: [describes[2]] }
];

for (const output of outputs) {
  const inner = output.take.join('\n\n');
  const used = helperNames.filter((name) =>
    new RegExp('(^|[^A-Za-z0-9_$])' + name + '([^A-Za-z0-9_$]|$)').test(inner)
  );
  const fileImports = usedNames(
    imports.filter((line) => !line.startsWith("import { describe, expect, it }")),
    inner
  );
  const head = [
    "import { describe, expect, it } from 'vitest';",
    ...fileImports,
    "import { " + used.join(', ') + " } from '../helpers/sessionsFixture';",
    ''
  ];
  writeFile(output.path, [...head, inner]);
}
