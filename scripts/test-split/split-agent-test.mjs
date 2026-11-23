import { readFileSync } from 'node:fs';
import { readImports, usedNames, splitIts, writeFile } from './test-split-lib.mjs';

const path = 'test/unit/agent.test.ts';
const lines = readFileSync(path, 'utf8').split(/\r?\n/);
const { imports, rest } = readImports(lines);
const describeAt = rest.findIndex((line) => line.startsWith('describe('));
if (describeAt < 0) {
  throw new Error('no describe found');
}
const helpers = rest.slice(0, describeAt);
const body = rest.slice(describeAt);
const its = splitIts(body);
console.log('cases: ' + its.length);

const helperImports = usedNames(imports, helpers.join('\n'));
const helperBody = helpers
  .filter((line) => !line.startsWith("import { describe, expect, it }"))
  .map((line) =>
    /^(class |function )/.test(line) ? 'export ' + line : line
  );
writeFile('test/helpers/agentFixture.ts', [...helperImports, '', ...helperBody]);

const outputs = [
  { path: 'test/unit/agent.test.ts', take: its.slice(0, 13) },
  { path: 'test/unit/agent-tools.test.ts', take: its.slice(13) }
];

for (const output of outputs) {
  const inner = output.take.join('\n');
  const content = ["describe('Agent', () => {", inner, '});'].join('\n');
  const names = ['FakeClient', 'makeAgent', 'textResponse', 'toolResponse'];
  const used = names.filter((name) =>
    new RegExp('(^|[^A-Za-z0-9_$])' + name + '([^A-Za-z0-9_$]|$)').test(inner)
  );
  const fileImports = usedNames(
    imports.filter((line) => !line.startsWith("import { describe, expect, it }")),
    inner
  );
  const head = [
    "import { describe, expect, it } from 'vitest';",
    ...fileImports,
    "import { " + used.join(', ') + " } from '../helpers/agentFixture';",
    ''
  ];
  writeFile(output.path, [...head, content]);
}
