import { describe, expect, it } from 'vitest';
import type { UiMessage } from '../../src/ui/protocol';
import {
  collectFileSources,
  describeCodeBlock,
  matchSource,
  parseReadFileContent
} from '../../src/ui/webview/codeBlock';

const READ_OUTPUT = [
  '1: export class AgentSession {',
  '2:   private readonly options: SessionOptions;',
  '3:   private readonly registry: ToolRegistry;',
  '4: }',
  '5: ',
  '6: export interface SessionOptions {'
].join('\n');

const SNIPPET = [
  'export class AgentSession {',
  '  private readonly options: SessionOptions;',
  '  private readonly registry: ToolRegistry;',
  '}'
].join('\n');

describe('describeCodeBlock', () => {
  it('keeps the language of a generated snippet', () => {
    const block = describeCodeBlock('ts');
    expect(block.title).toBe('ts');
    expect(block.language).toBe('ts');
    expect(block.file).toBe('');
  });

  it('names a snippet that comes from a file', () => {
    const block = describeCodeBlock('src/api/history.ts');
    expect(block.title).toBe('history.ts');
    expect(block.language).toBe('ts');
    expect(block.file).toBe('src/api/history.ts');
  });

  it('takes the file even when the language is written too', () => {
    const block = describeCodeBlock('ts src/api/history.ts');
    expect(block.title).toBe('history.ts');
    expect(block.language).toBe('ts');
    expect(block.file).toBe('src/api/history.ts');
  });

  it('reads the line of a snippet', () => {
    const block = describeCodeBlock('src/api/history.ts:42');
    expect(block.title).toBe('history.ts:42');
    expect(block.line).toBe(42);
    expect(block.file).toBe('src/api/history.ts');
  });

  it('understands the common extensions', () => {
    expect(describeCodeBlock('main.py').language).toBe('py');
    expect(describeCodeBlock('app.tsx').language).toBe('tsx');
    expect(describeCodeBlock('data.json').language).toBe('json');
    expect(describeCodeBlock('notes.md').language).toBe('md');
    expect(describeCodeBlock('run.sh').language).toBe('sh');
  });

  it('keeps an unknown extension plain', () => {
    const block = describeCodeBlock('data.bin');
    expect(block.language).toBe('text');
    expect(block.title).toBe('data.bin');
  });

  it('does not take a word for a file', () => {
    expect(describeCodeBlock('bash').file).toBe('');
    expect(describeCodeBlock('e.g.').file).toBe('');
  });

  it('survives an empty info', () => {
    expect(describeCodeBlock('').language).toBe('text');
    expect(describeCodeBlock('').title).toBe('');
  });

  it('names a snippet that the model did not name', () => {
    const sources = parseReadFileContent(['src/agent/session.ts'], READ_OUTPUT);
    const block = describeCodeBlock('ts', { content: SNIPPET, sources });
    expect(block.file).toBe('src/agent/session.ts');
    expect(block.line).toBe(1);
    expect(block.title).toBe('session.ts:1');
    expect(block.language).toBe('ts');
  });

  it('keeps the language when the snippet is not in any file', () => {
    const sources = parseReadFileContent(['src/agent/session.ts'], READ_OUTPUT);
    const block = describeCodeBlock('ts', {
      content: 'const answer = 42;',
      sources
    });
    expect(block.file).toBe('');
    expect(block.title).toBe('ts');
  });
});

describe('parseReadFileContent', () => {
  it('reads the lines of one file', () => {
    const sources = parseReadFileContent(['src/agent/session.ts'], READ_OUTPUT);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe('src/agent/session.ts');
    expect(sources[0]?.lines).toHaveLength(6);
    expect(sources[0]?.lines[0]).toEqual({ number: 1, text: 'export class AgentSession {' });
    expect(sources[0]?.lines[4]).toEqual({ number: 5, text: '' });
  });

  it('reads the lines of several files', () => {
    const content = ['=== a.ts ===', '1: const a = 1;', '', '=== b.ts ===', '1: const b = 2;'].join(
      '\n'
    );
    const sources = parseReadFileContent(['a.ts', 'b.ts'], content);
    expect(sources.map((source) => source.path)).toEqual(['a.ts', 'b.ts']);
    expect(sources[1]?.lines[0]?.text).toBe('const b = 2;');
  });

  it('reads the lines of a file with windows line endings', () => {
    const sources = parseReadFileContent(['a.ts'], '1: const a = 1;\r\n2: const b = 2;');
    expect(sources[0]?.lines).toHaveLength(2);
    expect(sources[0]?.lines[1]?.text).toBe('const b = 2;');
  });

  it('ignores the marker of a truncated file', () => {
    const sources = parseReadFileContent(['a.ts'], '1: const a = 1;\n[truncated]');
    expect(sources[0]?.lines).toHaveLength(1);
  });
});

describe('matchSource', () => {
  const sources = parseReadFileContent(['src/agent/session.ts'], READ_OUTPUT);

  it('finds the file and the line of a snippet', () => {
    const match = matchSource(SNIPPET, sources);
    expect(match?.path).toBe('src/agent/session.ts');
    expect(match?.line).toBe(1);
  });

  it('finds a snippet that starts in the middle of the file', () => {
    const match = matchSource('  private readonly registry: ToolRegistry;', sources);
    expect(match?.line).toBe(3);
  });

  it('finds a snippet with a hidden part', () => {
    const snippet = ['export class AgentSession {', '  ...', '  private readonly registry: ToolRegistry;'].join(
      '\n'
    );
    const match = matchSource(snippet, sources);
    expect(match?.line).toBe(1);
  });

  it('gives up when the lines are in several places', () => {
    const duplicated = ['1: }', '2: const a = 1;', '3: }'].join('\n');
    const many = parseReadFileContent(['a.ts'], duplicated);
    expect(matchSource('}', many)).toBeUndefined();
  });

  it('gives up when the snippet is not in the file', () => {
    expect(matchSource('const answer = 42;', sources)).toBeUndefined();
  });
});

describe('collectFileSources', () => {
  it('collects the files the agent has read', () => {
    const messages: UiMessage[] = [
      {
        id: 'tool-1',
        role: 'tool',
        tool: {
          id: 'tool-1',
          name: 'read_file',
          input: { path: 'src/agent/session.ts' },
          content: READ_OUTPUT
        }
      }
    ];
    const sources = collectFileSources(messages);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.path).toBe('src/agent/session.ts');
  });

  it('ignores the other tools', () => {
    const messages: UiMessage[] = [
      {
        id: 'tool-1',
        role: 'tool',
        tool: {
          id: 'tool-1',
          name: 'list_files',
          input: {},
          content: 'src'
        }
      }
    ];
    expect(collectFileSources(messages)).toHaveLength(0);
  });

  it('merges the reads of the same file', () => {
    const messages: UiMessage[] = [
      {
        id: 'tool-1',
        role: 'tool',
        tool: {
          id: 'tool-1',
          name: 'read_file',
          input: { path: 'a.ts' },
          content: '1: const a = 1;'
        }
      },
      {
        id: 'tool-2',
        role: 'tool',
        tool: {
          id: 'tool-2',
          name: 'read_file',
          input: { path: 'a.ts' },
          content: '2: const b = 2;'
        }
      }
    ];
    const sources = collectFileSources(messages);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.lines).toHaveLength(2);
  });
});
