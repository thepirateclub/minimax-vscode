// One chat that holds every kind of message of the panel. The stand of the
// panel and the check inside VS Code show the same chat.
import type { UiMessage, UiSessionSummary, UiUsageTurn } from '../../src/ui/protocol';

const README = Array.from({ length: 14 }, (_, i) => `${i + 1}: ${i % 3 === 0 ? 'import { join } from \'node:path\';' : i % 3 === 1 ? 'export function run(args: string[]): number {' : '  return args.length; // count'}`).join('\n');

// The start of an action of a sub-agent, the form of src/host/child.ts.
// The actions of the child started yesterday at 14:02, one every 15 seconds.
let childStep = 0;
function start(tool: string, input: Record<string, string>): string {
  const at = new Date();
  at.setDate(at.getDate() - 1);
  at.setHours(14, 2, 0, 0);
  return JSON.stringify({ tool, input, at: at.getTime() + childStep++ * 15_000 });
}

// The moments of the chat: it started yesterday at 14:00, a message every
// 40 seconds, the last answer closes the turn. The stand shows the date for
// the older day and the plate of the turn.
function stamped(messages: UiMessage[]): UiMessage[] {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  start.setHours(14, 0, 0, 0);
  const last = messages.map((message) => message.role === 'assistant' && !message.approval).lastIndexOf(true);
  return messages.map((message, index) => {
    const at = start.getTime() + index * 40_000;
    return index === last
      ? { ...message, at, elapsedMs: index * 40_000 + 12_000, endedAt: at + 12_000 }
      : { ...message, at };
  });
}

export const MESSAGES: UiMessage[] = stamped([
  { id: 'u1', role: 'user', text: 'Найди, где считается расход токенов, и добавь округление.' },
  {
    id: 'a1',
    role: 'assistant',
    thinking: 'The user wants rounding. Look at src/ui/format.ts first.',
    text: '## Plan\n\nI will read **format.ts**, then patch `formatCount`.\n\n1. Read the module\n2. Add the `B` suffix\n\n> The status bar uses the same helper.\n\n```ts\nexport function formatCount(value: number): string {\n  return value >= 1e9 ? (value / 1e9).toFixed(1) + \'B\' : String(value);\n}\n```\n\n| Suffix | Value |\n|---|---|\n| K | 1e3 |\n| M | 1e6 |'
  },
  {
    id: 'a2',
    role: 'assistant',
    // Every kind of nesting of an answer: the left edges and the indents of
    // the nested blocks are checked on this message.
    text: [
      '### Nested blocks',
      '',
      'A paragraph before the list.',
      '',
      '- First level with `code`',
      '  - Second level',
      '    - Third level with a long line that has to wrap and keep its indent under the marker',
      '  - Back to the second level',
      '- A step with a code block:',
      '',
      '  ```bash',
      '  npm run typecheck && npm test',
      '  ```',
      '',
      '- A step with a quote:',
      '',
      '  > Quoted inside a list item.',
      '',
      '1. Ordered',
      '   1. Nested ordered',
      '   2. Second nested',
      '2. Back',
      '',
      '- [x] Done task',
      '- [ ] Open task',
      '',
      '> A quote with a list:',
      '> - item one',
      '> - item two',
      '',
      '| Column | Code |',
      '|---|---|',
      '| long | `src/ui/webview/components/ToolCard.tsx` |',
      '',
      'A long link https://platform.minimax.io/docs/api-reference/text-anthropic-api-with-a-very-long-path and a longword_without_any_break_points_at_all_in_it_to_test_wrapping.'
    ].join('\n')
  },
  {
    id: 't1',
    role: 'tool',
    tool: { id: 't1', name: 'read_file', input: { path: 'src/ui/format.ts', start_line: 1, end_line: 14 }, content: README, durationMs: 4 }
  },
  {
    id: 't-task',
    role: 'tool',
    tool: {
      id: 't-task',
      name: 'task',
      input: { description: 'Find the callers of formatCount', role: 'explore', prompt: 'Find every caller of formatCount.' },
      content: 'formatCount is called in **statusBar.ts** and **Header.tsx**.',
      durationMs: 8400,
      // The journal in the form of the host (src/host/child.ts).
      progress: [
        start('list_files', { path: 'src/ui' }),
        'list_files done 1840ms',
        start('search_code', { query: 'formatCount', path: 'src' }),
        'search_code done 1840ms',
        start('read_file', { path: 'src/ui/statusBar.ts' }),
        'read_file done 1840ms',
        start('read_file', { path: 'src/ui/webview/components/Header.tsx' }),
        'read_file failed 1840ms',
        start('edit_file', { path: 'src/ui/format.ts' }),
        'edit_file done 1840ms',
        '+ export const B = 1e9;',
        '- export const M = 1e6;',
        '+ export const M = 1e6;',
        start('git_status', {})
      ]
    }
  },
  {
    id: 't-todo',
    role: 'tool',
    tool: {
      id: 't-todo',
      name: 'todo_write',
      input: { todos: [{ content: 'Read format.ts', status: 'completed', priority: 'high' }, { content: 'Add the B suffix', status: 'in_progress', priority: 'high' }] },
      content: 'Tasks updated: 1/3 done',
      durationMs: 1
    }
  },
  {
    id: 't-goal',
    role: 'tool',
    tool: { id: 't-goal', name: 'update_goal', input: { status: 'complete', note: 'Rounding works' }, content: 'Goal marked complete', durationMs: 1 }
  },
  {
    id: 't2',
    role: 'tool',
    tool: { id: 't2', name: 'search_code', input: { query: 'formatCount' }, content: 'src/ui/format.ts:3\nsrc/ui/statusBar.ts:12\nsrc/ui/webview/components/Header.tsx:5', durationMs: 18 }
  },
  {
    id: 't3',
    role: 'tool',
    tool: {
      id: 't3',
      name: 'edit_file',
      input: { path: 'src/ui/format.ts' },
      content: 'Edited src/ui/format.ts',
      durationMs: 9,
      diff: {
        path: 'src/ui/format.ts',
        lines: [
          { type: 'context', text: 'export function formatCount(value: number): string {' },
          { type: 'remove', text: '  return String(value);' },
          { type: 'add', text: '  if (value >= 1e9) return (value / 1e9).toFixed(1) + \'B\';' },
          { type: 'add', text: '  return String(value);' },
          { type: 'context', text: '}' }
        ]
      }
    }
  },
  {
    id: 't4',
    role: 'tool',
    tool: {
      id: 't4',
      name: 'run_terminal',
      input: { command: 'npm test -- format' },
      content: 'Command failed with exit code 1\n> vitest run format\n\nstderr: FAIL test/unit/format.test.ts > rounds billions\nstderr: AssertionError: expected \'1.0B\' to be \'1B\'\n Tests 1 failed | 12 passed',
      isError: true,
      durationMs: 2412
    }
  },
  {
    id: 't5',
    role: 'tool',
    tool: { id: 't5', name: 'list_files', input: { path: 'src/ui' }, content: 'format.ts\nprotocol.ts\nstatusBar.ts', durationMs: 2 }
  },
  {
    id: 't6',
    role: 'tool',
    tool: { id: 't6', name: 'run_terminal', input: { command: 'npm run typecheck' }, running: true }
  },
  {
    id: 't-repl',
    role: 'tool',
    tool: {
      id: 't-repl',
      name: 'repl_python',
      input: { code: 'import json\nrows = json.load(open("package.json"))\nprint(rows["version"])\nlen(rows["contributes"]["configuration"]["properties"])' },
      content: '0.24.0\n[stderr] DeprecationWarning: open() without encoding\n41',
      durationMs: 182
    }
  },
  { id: 'n1', role: 'notice', text: 'Cannot open src/missing.ts: the file does not exist.' },
  {
    id: 'ap1',
    role: 'assistant',
    approval: {
      id: 'ap1',
      name: 'write_file',
      input: { path: 'src/ui/format.ts' },
      preview: {
        path: 'src/ui/format.ts',
        lines: [
          { type: 'context', text: 'export function formatCount(value: number): string {' },
          { type: 'add', text: '  return value.toLocaleString();' },
          { type: 'context', text: '}' }
        ]
      }
    }
  },
  {
    id: 'ap2',
    role: 'assistant',
    approval: { id: 'ap2', name: 'run_terminal', input: { command: 'npm run typecheck && npm test' } }
  }
]);


// The chat of the folding sections: an answer, a step of the actions and three
// turns of the reasoning one after another. The stand shows it under
// ?sections=1, it is the case where the heads of the sections drifted apart.
export const SECTIONS: UiMessage[] = [
  { id: 's-u1', role: 'user', text: 'Перенеси хранилище на SQLite и проверь, как устроен сервер.' },
  {
    id: 's-a1',
    role: 'assistant',
    text: 'Принято: v1 остаётся рабочей веткой, main не трогаю. Теперь перевожу хранилище на SQLite.'
  },
  ...Array.from({ length: 11 }, (_, i) => ({
    id: 's-t' + i,
    role: 'tool' as const,
    tool: {
      id: 's-t' + i,
      name: 'read_file',
      input: { path: 'src/storage/sessions.ts' },
      content: 'export function read(): Session[] { return []; }',
      durationMs: 4
    }
  })),
  { id: 's-th1', role: 'assistant', thinking: 'First turn of the reasoning.' },
  { id: 's-th2', role: 'assistant', thinking: 'Second turn of the reasoning.' },
  { id: 's-th3', role: 'assistant', thinking: 'Third turn of the reasoning.' }
];

// The chat of the steps of the work: actions, a thought, actions again.
// The stand shows it under ?steps=1, the group of the actions has to end at
// the thought of the model.
export const SECTIONS_STEPS: UiMessage[] = [
  { id: 'w-u1', role: 'user', text: 'Перенеси хранилище на SQLite и проверь, как устроен сервер.' },
  {
    id: 'w-a1',
    role: 'assistant',
    text: 'Принято: v1 остаётся рабочей веткой, main не трогаю. Сначала посмотрю, как устроен сервер.'
  },
  ...Array.from({ length: 3 }, (_, i) => ({
    id: 'w-t' + i,
    role: 'tool' as const,
    tool: {
      id: 'w-t' + i,
      name: 'read_file',
      input: { path: 'src/storage/sessions.ts' },
      content: 'export function read(): Session[] { return []; }',
      durationMs: 4
    }
  })),
  { id: 'w-th1', role: 'assistant', thinking: 'The server keeps the chats in the state of the editor.' },
  ...Array.from({ length: 2 }, (_, i) => ({
    id: 'w-u' + i,
    role: 'tool' as const,
    tool: {
      id: 'w-u' + i,
      name: 'search_code',
      input: { query: 'sessions' },
      content: 'src/storage/sessions.ts:12',
      durationMs: 18
    }
  })),
  {
    id: 'w-run',
    role: 'tool',
    tool: {
      id: 'w-run',
      name: 'git_diff',
      input: { staged: false },
      content: 'diff --git a/src/storage/sessions.ts b/src/storage/sessions.ts',
      running: true
    }
  },
  { id: 'w-th2', role: 'assistant', thinking: 'The change touches the storage of the chats.' }
];

// The chat of the repeat of a request: one turn in the middle of the chat
// failed, so the panel shows the button of the repeat at that request. The
// chat is long enough to scroll and the reader has to scroll up to the old
// failure to press the button.
export const RETRY_MESSAGES: UiMessage[] = Array.from({ length: 100 }, (_, i) => {
  const turn: UiMessage[] = [
    {
      id: 'r-u' + i,
      role: 'user',
      text: 'Request ' + (i + 1) + ': check the module and tell me what is wrong in it.'
    },
    {
      id: 'r-a' + i,
      role: 'assistant',
      text:
        'Answer ' +
        (i + 1) +
        ': the module reads the file and returns the result. ' +
        'The check of the details of the work. '.repeat(6)
    }
  ];
  if (i === 70) {
    turn.push({
      id: 'r-err',
      role: 'notice',
      kind: 'error' as const,
      text: 'The request failed: 500 Internal Server Error'
    });
  }
  return turn;
}).flat();

// The panel holds the tail of the chat, the older part waits in the host.
// The repeat of a request brings another tail of the same size, so the
// panel does not see the change by the number of the messages.
export const RETRY_PAGE = 120;
export const RETRY_TAIL: UiMessage[] = RETRY_MESSAGES.slice(-RETRY_PAGE);

// The chat of the previews of the sections: a long reasoning and a group of
// actions. The folded sections show one line of them, the reader opens the
// section by a click.
export const PREVIEW_MESSAGES: UiMessage[] = [
  {
    id: 'p-u1',
    role: 'user',
    text: 'Перенеси хранилище на SQLite и проверь, как устроен сервер.'
  },
  {
    id: 'p-a1',
    role: 'assistant',
    thinking:
      'The user wants the storage on SQLite. I look at the server first: the chats live in the state of the editor and the store writes them down. Then I read the module of the sessions and the way the panel shows them. The change touches the storage of the chats and the server that keeps them.',
    text: 'Принято: v1 остаётся рабочей веткой, main не трогаю. Теперь переношу хранилище.'
  },
  {
    id: 'p-t1',
    role: 'tool',
    tool: {
      id: 'p-t1',
      name: 'read_file',
      input: { path: 'src/storage/sessions.ts' },
      content: 'export function read(): Session[] { return []; }',
      durationMs: 4
    }
  },
  {
    id: 'p-t2',
    role: 'tool',
    tool: {
      id: 'p-t2',
      name: 'read_file',
      input: { path: 'src/tools/git.ts' },
      content: 'export function status(): string { return ""; }',
      durationMs: 3
    }
  }
];

export function sessions(now: number): UiSessionSummary[] {
  return [
    { id: 's1', title: 'Rounding of the token counter', updatedAt: now },
    { id: 's2', title: 'Fix the diff colors in the light theme of the editor', updatedAt: now - 90_000_000 }
  ];
}

export const USAGE: UiUsageTurn[] = Array.from({ length: 18 }, (_, i) => ({
  input: 2000 + ((i * 937) % 5000),
  output: 200 + ((i * 431) % 1600),
  cache: i % 4 === 0 ? 800 : 0
}));
