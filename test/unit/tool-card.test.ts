import { describe, expect, it } from 'vitest';
import { card, ruleFor, property, dotClasses, summaryOf, titleOf, addedOf, removedOf, CSS } from '../helpers/toolCardFixture';

describe('the dot of an action', () => {
  it('paints a finished action green', () => {
    const classes = dotClasses(card({}));
    expect(classes).toContain('tool-dot-done');
    const body = ruleFor(CSS, '.tool-dot.tool-dot-done');
    expect(body).toBeDefined();
    // The token of success is built on the color of the passed test.
    expect(property(body, 'background')).toBe('var(--ok)');
  });

  it('paints a failed action red', () => {
    const classes = dotClasses(card({ isError: true }));
    expect(classes).toContain('tool-dot-failed');
    const body = ruleFor(CSS, '.tool-dot.tool-dot-failed');
    expect(body).toBeDefined();
    expect(property(body, 'background')).toBe('var(--err)');
  });

  it('blinks a running action with the gray of the base dot', () => {
    const classes = dotClasses(card({ running: true }));
    expect(classes).toContain('tool-dot-running');
    const body = ruleFor(CSS, '.tool-dot.tool-dot-running');
    expect(body).toBeDefined();
    expect(property(body, 'background')).toBe('var(--muted)');
    expect(property(body, 'animation')).toContain('mm-pulse');
  });

  it('keeps a finished result steady', () => {
    for (const state of ['done', 'failed']) {
      const body = ruleFor(CSS, '.tool-dot.tool-dot-' + state);
      expect(body).toBeDefined();
      expect(property(body, 'animation')).toBeUndefined();
    }
  });

  it('hides the body of an action when the setting asks for it', () => {
    expect(card({}, true)).not.toContain('tool-body');
    expect(card({}, false)).toContain('tool-body');
  });

  it('names the git action in the header of the card', () => {
    expect(titleOf(card({ name: 'git_status', input: {}, content: 'branch: main' }))).toBe(
      'Git status'
    );
    expect(titleOf(card({ name: 'git_commit', input: { message: 'feat: x' }, content: 'committed' }))).toBe(
      'Commit'
    );
    expect(
      titleOf(card({ name: 'git_stage', input: { paths: ['src/app.ts'] }, content: 'staged' }))
    ).toBe('Stage src/app.ts');
    expect(
      titleOf(card({ name: 'git_branch_create', input: { name: 'feature/x' }, content: 'created' }))
    ).toBe('Create branch feature/x');
  });

  it('does not repeat the path of the file in the summary', () => {
    const markup = card({
      name: 'write_file',
      input: { path: 'src/app.ts' },
      content: 'Wrote src/app.ts'
    });
    expect(markup).toContain('Write src/app.ts');
    expect(summaryOf(markup)).toBe('');
  });

  it('keeps the text of a failed write in the summary', () => {
    const markup = card({
      name: 'write_file',
      input: { path: 'src/app.ts' },
      content: 'write_file failed: the disk is full',
      isError: true
    });
    expect(summaryOf(markup)).toContain('write_file failed: the disk is full');
  });

  it('keeps the card of an action quiet', () => {
    // The card is a note under the answer, it must not compete with it.
    const card = ruleFor(CSS, '.tool-card');
    expect(property(card, 'border')).toBe('none');
    expect(property(card, 'background')).toBe('transparent');
    expect(property(ruleFor(CSS, '.tool-title'), 'font-weight')).toBe('400');
    expect(property(ruleFor(CSS, '.tool-title'), 'color')).toBe('var(--muted)');
    expect(property(ruleFor(CSS, '.tool-head:hover .tool-title'), 'color')).toBe(
      'var(--fg)'
    );
    expect(property(ruleFor(CSS, '.tool-head'), 'font-size')).toBe('var(--fs-sm)');
  });

  it('shows the change of a file as a diff', () => {
    const markup = card({
      name: 'write_file',
      input: { path: 'src/app.ts', content: 'const a = 1;' },
      content: 'Wrote src/app.ts',
      diff: {
        path: 'src/app.ts',
        lines: [{ type: 'add', newLine: 1, text: 'const a = 1;' }]
      }
    });
    expect(markup).toContain('diff-line');
    expect(markup).toContain('const a = 1;');
    // The title of the card names the file, the diff does not repeat it.
    expect(markup).not.toContain('diff-path');
  });

  it('shows an old edit as a diff', () => {
    const markup = card({
      name: 'edit_file',
      input: {
        path: 'src/app.ts',
        old_string: 'const a = 1;',
        new_string: 'const a = 2;'
      },
      content: 'Edited src/app.ts'
    });
    // The chat of an old session keeps the arguments of an edit, not its diff.
    expect(markup).toContain('diff-line');
    expect(markup).toContain('const a = 1;');
    expect(markup).toContain('const a = 2;');
    expect(markup).not.toContain('old_string:');
    expect(addedOf(markup)).toBe('+1');
    expect(removedOf(markup)).toBe('-1');
  });

  it('keeps the arguments of a failed edit', () => {
    const markup = card({
      name: 'edit_file',
      input: {
        path: 'src/app.ts',
        old_string: 'const a = 1;',
        new_string: 'const a = 2;'
      },
      content: 'edit_file failed: old_string not found in the file',
      isError: true
    });
    // A failed edit changed nothing, a diff of it would lie.
    expect(markup).toContain('tool-input');
    expect(markup).not.toContain('diff-line');
  });

  it('marks a failed action with a straight bar in the color of the failed dot', () => {
    const error = ruleFor(CSS, '.tool-card.tool-error');
    // The bar and the failed dot share one token, a theme cannot split them.
    expect(property(error, 'border-left')).toBe('2px solid var(--err)');
    expect(property(ruleFor(CSS, '.tool-dot.tool-dot-failed'), 'background')).toBe('var(--err)');
    // A rounded border draws a bracket, it looks like a decoration.
    expect(property(error, 'border-radius')).toBe('0');
  });

  it('paints only the base dot gray', () => {
    const base = ruleFor(CSS, '.tool-dot');
    expect(property(base, 'background')).toBe('var(--muted)');
    for (const state of ['done', 'failed']) {
      const body = ruleFor(CSS, '.tool-dot.tool-dot-' + state);
      expect(property(body, 'background')).not.toBe('var(--muted)');
    }
  });

  it('paints the change of a file in the colors of a diff', () => {
    // A change has to be visible at a glance, a gray text hides it.
    const added = ruleFor(CSS, '.diff-add');
    expect(property(added, 'color')).toBe('var(--diff-add-fg)');
    expect(property(added, 'background')).toBe('var(--diff-add-bg)');
    const removed = ruleFor(CSS, '.diff-remove');
    expect(property(removed, 'color')).toBe('var(--diff-remove-fg)');
    expect(property(removed, 'background')).toBe('var(--diff-remove-bg)');
    // The mark of the line carries the color as well.
    expect(property(ruleFor(CSS, '.diff-add .diff-marker'), 'color')).toBe(
      'var(--diff-add-fg)'
    );
    expect(property(ruleFor(CSS, '.diff-remove .diff-marker'), 'color')).toBe(
      'var(--diff-remove-fg)'
    );
  });

  it('shows the size of the change in the header of the card', () => {
    const markup = card({
      name: 'write_file',
      input: { path: 'src/app.ts' },
      content: 'Wrote src/app.ts',
      diff: {
        path: 'src/app.ts',
        lines: [
          { type: 'context', oldLine: 1, newLine: 1, text: 'keep' },
          { type: 'remove', oldLine: 2, text: 'old' },
          { type: 'add', newLine: 2, text: 'new' },
          { type: 'add', newLine: 3, text: 'more' }
        ]
      }
    });
    expect(addedOf(markup)).toBe('+2');
    expect(removedOf(markup)).toBe('-1');
  });

  it('keeps the size of the change visible in a folded card', () => {
    const markup = card(
      {
        name: 'write_file',
        input: { path: 'src/app.ts' },
        content: 'Wrote src/app.ts',
        diff: {
          path: 'src/app.ts',
          lines: [{ type: 'add', newLine: 1, text: 'const a = 1;' }]
        }
      },
      true
    );
    expect(addedOf(markup)).toBe('+1');
  });

  it('hides the empty half of the size', () => {
    const markup = card({
      name: 'write_file',
      input: { path: 'src/app.ts' },
      content: 'Wrote src/app.ts',
      diff: {
        path: 'src/app.ts',
        lines: [{ type: 'add', newLine: 1, text: 'const a = 1;' }]
      }
    });
    // A new file removes nothing, a zero in red looks like a mistake.
    expect(addedOf(markup)).toBe('+1');
    expect(removedOf(markup)).toBe('');
    expect(markup).not.toContain('-0');
  });

  it('shows no size for an action without a change', () => {
    expect(card({})).not.toContain('tool-stats');
  });

  it('keeps the time and the dot at the right edge', () => {
    const markup = card({ durationMs: 12 });
    expect(markup).toContain('tool-tail');
    // The tail is pushed to the right, the title keeps the left edge.
    expect(property(ruleFor(CSS, '.tool-tail'), 'margin-left')).toBe('auto');
  });

  // The gutter of the numbers takes room only when there are numbers: an
  // empty gutter pushed the text of the file far from the frame.
  it('draws no gutter when the lines of a read carry no numbers', () => {
    const markup = card({
      name: 'read_file',
      input: { path: 'demo.ts' },
      content: 'export function read(): void {}'
    });
    expect(markup).toContain('file-read-text');
    expect(markup).not.toContain('file-read-num');
  });

  it('shows a read of a file as numbered lines', () => {
    const markup = card({
      name: 'read_file',
      input: { path: 'demo.txt' },
      content: '1: alpha\n2: beta'
    });
    expect(markup).toContain('file-read-num');
    expect(markup).toContain('file-read-text');
    expect(markup).toContain('alpha');
    // The title of the card names the file, the body does not echo the path.
    expect(markup).not.toContain('path: demo.txt');
  });

  it('shows the output of a command as a terminal', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'dir tmp-demo.txt' },
      content: 'Volume in drive H has no label.'
    });
    expect(markup).toContain('term-command');
    expect(markup).toContain('dir tmp-demo.txt');
    // The command stands on its own line, it is not echoed as an argument.
    expect(markup).not.toContain('command: dir tmp-demo.txt');
  });

  it('shows the command as a terminal while it runs', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'npm test' },
      // The command runs, it has no output yet.
      content: undefined,
      running: true
    });
    expect(markup).toContain('term-command');
    expect(markup).toContain('npm test');
    // The raw arguments of the tool do not show while the command runs.
    expect(markup).not.toContain('tool-input');
  });

  it('marks the failure of a command', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'bad' },
      content: 'Command failed with exit code 255\n[stderr] not recognized',
      isError: true
    });
    expect(markup).toContain('term-line-error');
    expect(markup).toContain('not recognized');
  });

  it('marks the stream of the error in the terminal', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'bad' },
      content: 'Command failed with exit code 255\n[stderr] not recognized',
      isError: true
    });
    expect(markup).toContain('term-chip');
    expect(markup).toContain('stderr');
  });

  it('holds a long command in three lines', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'npm run build -- --watch --mode production --outDir dist' },
      content: 'done'
    });
    // The command opens on a click, the style sheet holds it in three lines.
    expect(markup).toContain('term-command');
    expect(CSS).toMatch(/\.term-cmd-text\s*\{[^}]*-webkit-line-clamp:\s*3/);
    // The copy button stands in the corner, the command keeps room for it.
    expect(property(ruleFor(CSS, '.term-command'), 'padding')).toContain('32px');
  });

  it('keeps the summary of a finished command empty', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'dir' },
      content: 'Volume in drive H has no label.'
    });
    expect(summaryOf(markup)).toBe('');
  });

  it('shows the range of a read in the title', () => {
    const markup = card({
      name: 'read_file',
      input: { path: 'demo.txt', start_line: 10, end_line: 40 },
      content: '10: alpha'
    });
    expect(markup).toContain('Read demo.txt 10-40');
  });

  it('does not repeat the command in the header of an open card', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'dir tmp-demo.txt' },
      content: 'Volume in drive H has no label.'
    });
    // The command stands in the terminal block, the header names the action.
    expect(titleOf(markup)).toBe('Run');
    expect(markup).toContain('term-command');
  });

  it('keeps the command in the header of a folded card', () => {
    const markup = card(
      {
        name: 'run_terminal',
        input: { command: 'dir tmp-demo.txt' },
        content: 'Volume in drive H has no label.'
      },
      true
    );
    // The body is hidden, so the header has to name the command.
    expect(titleOf(markup)).toBe('Run dir tmp-demo.txt');
  });

  it('shows the exit code of a failed command only in the header', () => {
    const markup = card({
      name: 'run_terminal',
      input: { command: 'bad' },
      content: 'Command failed with exit code 255\n[stderr] not recognized',
      isError: true
    });
    expect(summaryOf(markup)).toBe('exit code 255');
    // The wrapper of the tool repeats the exit code, the transcript does not.
    expect(markup).not.toContain('Command failed with exit code');
  });
});
