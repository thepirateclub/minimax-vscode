import type { MiniMaxClient } from '../api/client';
import type { AnthropicMessage, EffortLevel, Usage } from '../api/types';

export interface CommitContext {
  files: Array<{ path: string; status: string }>;
  diff: string;
  recentSubjects: string[];
}

// The text of the prompt is English, the commit message itself is Russian:
// the history of the project is written that way.
export const COMMIT_SYSTEM_PROMPT = [
  'You write commit messages for a software project.',
  'Answer with the commit message only, one line, without quotes and without a code fence.',
  'Use the Conventional Commits format: <type>(<scope>): <subject>.',
  'The allowed types are feat, fix, refactor, test, docs, chore, perf, build, ci, style.',
  'Write the subject in Russian, in the imperative mood, at most 72 characters.',
  'Add the scope only when the change touches one area of the project.',
  'Do not add a body, do not explain the change.'
].join(' ');

const TYPES = [
  'feat',
  'fix',
  'docs',
  'test',
  'refactor',
  'chore',
  'perf',
  'build',
  'ci',
  'style'
];

const CONVENTIONAL = new RegExp('^(' + TYPES.join('|') + ')(\\([^)]*\\))?!?:', 'i');

// The model sometimes writes another word for the type, the commit message
// has to stay conventional.
const SYNONYMS: Record<string, string> = {
  feature: 'feat',
  features: 'feat',
  bugfix: 'fix',
  hotfix: 'fix',
  doc: 'docs',
  documentation: 'docs',
  tests: 'test',
  testing: 'test',
  refactoring: 'refactor',
  performance: 'perf',
  chores: 'chore',
  styling: 'style'
};

const TYPE_LINE = /^([A-Za-z]+)(\([^)]*\))?!?:/;

export function buildCommitPrompt(context: CommitContext): string {
  const files = context.files.map((file) => file.status + ' ' + file.path).join('\n');
  const parts = [
    'Changed files:',
    files.length > 0 ? files : '(none)',
    '',
    'Diff:',
    context.diff.length > 0 ? context.diff : '(empty)'
  ];
  if (context.recentSubjects.length > 0) {
    parts.push(
      '',
      'The subjects of the last commits:',
      context.recentSubjects.map((subject) => '- ' + subject).join('\n')
    );
  }
  return parts.join('\n');
}

// The model likes to add a greeting, the message is the conventional line.
export function cleanCommitMessage(text: string): string {
  const lines = text
    .replace(/```[a-z]*\n?/gi, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const conventional = lines.find((line) => CONVENTIONAL.test(line));
  const chosen = conventional ?? lines[0] ?? '';
  return normalizeType(
    chosen
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\.$/, '')
      .trim()
  );
}

// The type of the commit is repaired, a wrong word is worse than a chore.
export function normalizeType(line: string): string {
  const match = TYPE_LINE.exec(line);
  const raw = match?.[1];
  if (!raw) {
    return line;
  }
  const type = raw.toLowerCase();
  const known = TYPES.includes(type) ? type : SYNONYMS[type];
  const fixed = known ?? closestType(type);
  return fixed + line.slice(raw.length);
}

function closestType(type: string): string {
  let best = 'chore';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of TYPES) {
    const distance = editDistance(type, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= 2 ? best : 'chore';
}

// The distance between two words, the count of the changed letters.
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous: number[] = [];
  for (let j = 0; j < cols; j++) {
    previous.push(j);
  }
  for (let i = 1; i < rows; i++) {
    const current: number[] = [i];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const diagonal = (previous[j - 1] ?? 0) + cost;
      const left = (current[j - 1] ?? 0) + 1;
      const up = (previous[j] ?? 0) + 1;
      current.push(Math.min(diagonal, left, up));
    }
    previous = current;
  }
  return previous[cols - 1] ?? 0;
}

export async function generateCommitMessage(options: {
  client: MiniMaxClient;
  model: string;
  maxTokens: number;
  effort: EffortLevel;
  thinking?: 'adaptive';
  context: CommitContext;
  signal?: AbortSignal;
}): Promise<{ message: string; usage: Usage }> {
  const messages: AnthropicMessage[] = [
    {
      role: 'user',
      content: [{ type: 'text', text: buildCommitPrompt(options.context) }]
    }
  ];
  let text = '';
  let usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const stream = options.client.stream(
    {
      model: options.model,
      maxTokens: options.maxTokens,
      system: COMMIT_SYSTEM_PROMPT,
      messages,
      effort: options.effort,
      thinking: options.thinking,
      signal: options.signal
    },
    { signal: options.signal }
  );
  for await (const event of stream) {
    if (event.type === 'text_delta') {
      text += event.text;
    }
    if (event.type === 'message_stop') {
      usage = event.usage;
    }
  }
  return { message: cleanCommitMessage(text), usage };
}
