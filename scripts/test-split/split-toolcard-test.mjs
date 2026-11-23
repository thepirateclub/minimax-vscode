import { readFileSync } from 'node:fs';
import { assertNotSplit, readImports, usedNames, writeFile } from './test-split-lib.mjs';

// The split of the card is already done: a second run would write the
// describes of the monolith again and leave the second file empty.
assertNotSplit(['test/helpers/toolCardFixture.ts', 'test/unit/tool-card-body.test.ts']);

const path = 'test/unit/tool-card.test.ts';
const lines = readFileSync(path, 'utf8').split(/\r?\n/);
const { imports, rest } = readImports(lines);
const firstDescribe = rest.findIndex((line) => line.startsWith('describe('));
const helpers = rest.slice(0, firstDescribe);
const body = rest.slice(firstDescribe);

// The describes of the file live at the left margin.
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

// The helper with the rules of the style sheet and the builder of a card.
const helperImports = usedNames(
  imports.filter((line) => !line.startsWith("import { describe, expect, it }")),
  helpers.join('\n')
);
const helperBody = helpers.map((line) =>
  /^(function |const |class )/.test(line) ? 'export ' + line : line
);
writeFile('test/helpers/toolCardFixture.ts', [...helperImports, '', ...helperBody]);

const helperNames = ['card', 'rules', 'ruleFor', 'property', 'dotClasses', 'summaryOf', 'titleOf', 'addedOf', 'removedOf', 'CSS'];

const outputs = [
  { path: 'test/unit/tool-card.test.ts', take: [describes[0]] },
  { path: 'test/unit/tool-card-body.test.ts', take: describes.slice(1) }
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
    "import { " + used.join(', ') + " } from '../helpers/toolCardFixture';",
    ''
  ];
  writeFile(output.path, [...head, inner]);
}
