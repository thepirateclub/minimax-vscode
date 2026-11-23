import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThinkingBlock } from '../../src/ui/webview/components/ThinkingBlock';
import { ToolSteps } from '../../src/ui/webview/components/ToolSteps';
import {
  PREVIEW_CHARS,
  PREVIEW_WORDS,
  actionPreview,
  thinkingPreview
} from '../../src/ui/webview/sectionPreview';
import type { UiMessage } from '../../src/ui/protocol';
import { readStyles } from '../helpers/styles';

const CSS = readStyles();

function rule(selector: string): string {
  const index = CSS.indexOf(selector + ' {');
  if (index === -1) {
    return '';
  }
  const start = CSS.indexOf('{', index);
  const end = CSS.indexOf('}', start);
  return CSS.slice(start + 1, end);
}

function toolMessage(id: string, name: string, input: Record<string, unknown>): UiMessage {
  return { id, role: 'tool', tool: { id, name, input } };
}

describe('the preview of the reasoning', () => {
  it('takes the first words of it', () => {
    const text =
      'The user wants the rounding of the token count. ' +
      'I read src/ui/format.ts first, then patch the helper of the panel. '.repeat(4);
    const preview = thinkingPreview(text);
    expect(preview.startsWith('The user wants the rounding of the token count.')).toBe(
      true
    );
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
  });

  it('keeps a short reasoning whole', () => {
    expect(thinkingPreview('The model thinks about the file.')).toBe(
      'The model thinks about the file.'
    );
  });

  it('cuts the reasoning on the bound of the words', () => {
    const words = Array.from({ length: PREVIEW_WORDS + 20 }, (_, i) => 'w' + i);
    const preview = thinkingPreview(words.join(' '));
    expect(preview.split(' ')).toHaveLength(PREVIEW_WORDS);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('cuts the reasoning on the bound of the characters', () => {
    const long = 'x'.repeat(PREVIEW_CHARS + 50);
    const preview = thinkingPreview(long);
    expect(preview.length).toBeLessThanOrEqual(PREVIEW_CHARS + 1);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('makes one line of the reasoning', () => {
    const preview = thinkingPreview('first line\nsecond line\nthird line');
    expect(preview).toBe('first line second line third line');
  });
});

describe('the preview of the actions', () => {
  it('names the tool and the object of it', () => {
    const tool = {
      id: 't1',
      name: 'read_file',
      input: { path: 'src/tools/git.ts' }
    };
    expect(actionPreview(tool)).toBe('read_file src/tools/git.ts');
  });

  it('names the command of the terminal', () => {
    const tool = { id: 't2', name: 'run_terminal', input: { command: 'npm test' } };
    expect(actionPreview(tool)).toBe('run_terminal npm test');
  });

  it('names the tool alone when it has no object', () => {
    const tool = { id: 't3', name: 'git_status', input: { staged: false } };
    expect(actionPreview(tool)).toBe('git_status');
  });
});

describe('the folded sections of the chat', () => {
  it('shows the first words of the reasoning under the head', () => {
    const markup = renderToStaticMarkup(
      createElement(ThinkingBlock, {
        text: 'The user wants the rounding of the token count. I read the file.'
      })
    );
    expect(markup).toContain('section-preview');
    expect(markup).toContain('The user wants the rounding of the token count.');
    // The whole reasoning is not in the folded section.
    expect(markup).not.toContain('thinking-body');
  });

  it('shows the last action of the group under the head', () => {
    const tools = [
      toolMessage('t1', 'read_file', { path: 'src/ui/format.ts' }),
      toolMessage('t2', 'read_file', { path: 'src/tools/git.ts' })
    ];
    const markup = renderToStaticMarkup(
      createElement(ToolSteps, { step: { id: 'step-1', tools }, collapsed: false })
    );
    expect(markup).toContain('section-preview');
    // The last action of the group, not the first one.
    expect(markup).toContain('read_file src/tools/git.ts');
    expect(markup).not.toContain('read_file src/ui/format.ts');
  });

  it('opens the section on a click of the preview', () => {
    const markup = renderToStaticMarkup(
      createElement(ThinkingBlock, { text: 'The model thinks about the file.' })
    );
    // The preview is a button: a click on it opens the section.
    expect(markup).toContain('<button class="section-preview"');
  });

  it('draws the preview as one italic line', () => {
    const preview = rule('.section-preview');
    expect(preview).toMatch(/font-style:\s*italic/);
    // The preview takes the free middle of the head, the title keeps its
    // place and the counter stands on the right.
    expect(preview).toMatch(/grid-column:\s*4/);
    expect(rule('.section-head')).toMatch(
      /grid-template-columns:\s*14px 14px auto minmax\(0, 1fr\) auto/
    );
    expect(rule('.tool-steps-count')).toMatch(/grid-column:\s*5/);
    const text = rule('.section-preview-text');
    expect(text).toMatch(/white-space:\s*nowrap/);
    expect(text).toMatch(/text-overflow:\s*ellipsis/);
    expect(text).toMatch(/overflow:\s*hidden/);
  });

  it('puts the preview in the same row as the name of the section', () => {
    const markup = renderToStaticMarkup(
      createElement(ThinkingBlock, { text: 'The model thinks about the file.' })
    );
    const head = markup.indexOf('section-head');
    const title = markup.indexOf('section-title');
    const preview = markup.indexOf('section-preview');
    expect(head).toBeGreaterThan(-1);
    // The name of the section stands before the preview.
    expect(title).toBeGreaterThan(head);
    expect(preview).toBeGreaterThan(title);
    // The preview is a part of the head, not a row of its own: between the
    // head and the preview no row of the section closes.
    expect(markup.slice(head, preview)).not.toContain('</div>');
  });

  it('keeps the counter of the group on the right of the preview', () => {
    const tools = [toolMessage('t1', 'read_file', { path: 'src/tools/git.ts' })];
    const markup = renderToStaticMarkup(
      createElement(ToolSteps, { step: { id: 'step-1', tools }, collapsed: false })
    );
    const preview = markup.indexOf('section-preview');
    const count = markup.indexOf('tool-steps-count');
    expect(preview).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(preview);
  });

  it('has no live status over the field of the request', () => {
    // The status of the agent moved into the head of the actions: the row
    // over the field is gone.
    expect(CSS).not.toContain('.composer-activity');
  });
});
