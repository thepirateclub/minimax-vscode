import { describe, expect, it } from 'vitest';
import {
  noRunawayRepeats,
  readsBeforeEdits,
  recoversFromFailedEdit,
  refusalsVisible,
  respectsPlanMode,
  stopsWith
} from './checks';
import { call, lastResult, runScenario, say, type Step } from './harness';

const APP = 'export function add(a: number, b: number) {\n  return a - b;\n}\n';

// The step fails the scenario loudly when the agent sent something else
// than the script expects: a silent mismatch would pass a broken loop.
function expectResult(match: (content: string, isError: boolean) => boolean, next: Step): Step {
  return (request) => {
    const result = lastResult(request);
    if (!result || !match(result.content, result.isError)) {
      throw new Error(`unexpected tool result: ${JSON.stringify(result)}`);
    }
    return next(request);
  };
}

describe('eval: agent loop', () => {
  it('reads a file before it edits it and ends the turn with an answer', async () => {
    const trace = await runScenario({
      files: { 'src/math.ts': APP },
      prompt: 'Fix add in src/math.ts',
      steps: [
        call({ name: 'read_file', input: { path: 'src/math.ts' } }),
        expectResult(
          (content) => content.includes('return a - b'),
          call({ name: 'edit_file', input: { path: 'src/math.ts', old_string: 'return a - b;', new_string: 'return a + b;' } })
        ),
        expectResult((_, isError) => !isError, say('Fixed: add now sums its arguments.'))
      ]
    });
    expect(readsBeforeEdits(trace, ['src/math.ts'])).toEqual([]);
    expect(stopsWith(trace, 'end_turn')).toEqual([]);
    expect(trace.file('src/math.ts')).toContain('return a + b;');
    expect(trace.approvals).toHaveLength(1);
  });

  it('flags an edit made blind, without a read', async () => {
    const trace = await runScenario({
      files: { 'src/math.ts': APP },
      prompt: 'Fix add',
      steps: [
        call({ name: 'edit_file', input: { path: 'src/math.ts', old_string: 'return a - b;', new_string: 'return a + b;' } }),
        say('Done.')
      ]
    });
    expect(readsBeforeEdits(trace, ['src/math.ts'])).toEqual(['edit_file src/math.ts before read_file']);
  });

  it('recovers from a failed edit_file with the snippet the error shows', async () => {
    const trace = await runScenario({
      files: { 'src/math.ts': APP },
      prompt: 'Fix add',
      steps: [
        call({ name: 'read_file', input: { path: 'src/math.ts' } }),
        call({ name: 'edit_file', input: { path: 'src/math.ts', old_string: 'export function add(a: number, b: number) {\n  return a minus b;', new_string: 'return a + b;' } }),
        // The miss shows the nearest part of the file, the model fixes
        // old_string from it instead of reading the file again.
        expectResult(
          (content, isError) => isError && content.includes('return a - b;'),
          call({ name: 'edit_file', input: { path: 'src/math.ts', old_string: 'return a - b;', new_string: 'return a + b;' } })
        ),
        expectResult((_, isError) => !isError, say('Fixed.'))
      ]
    });
    expect(recoversFromFailedEdit(trace)).toEqual([]);
    expect(trace.file('src/math.ts')).toContain('return a + b;');
    expect(trace.tools.filter((record) => record.name === 'read_file')).toHaveLength(1);
  });

  it('stops a loop of identical calls and shows every refusal', async () => {
    const same = call({ name: 'read_file', input: { path: 'src/math.ts' } });
    const trace = await runScenario({
      files: { 'src/math.ts': APP },
      prompt: 'Look at math',
      steps: [same, same, same, same, same, say('I keep reading the same file, stopping.')]
    });
    expect(noRunawayRepeats(trace, 3)).toEqual([]);
    expect(refusalsVisible(trace)).toEqual([]);
    const refused = trace.tools.filter((record) => record.isError);
    expect(refused).toHaveLength(2);
    expect(refused[0]!.content).toContain('Change the approach');
    expect(stopsWith(trace, 'end_turn')).toEqual([]);
  });

  it('runs out of iterations with an explained stop reason', async () => {
    const steps = Array.from({ length: 4 }, (_, index) => call({ name: 'grep', input: { pattern: `x${index}` } }));
    const trace = await runScenario({ files: { 'a.ts': 'x0\n' }, prompt: 'Search', steps, maxIterations: 4 });
    expect(stopsWith(trace, 'max_iterations')).toEqual([]);
    expect(trace.events.at(-1)).toMatchObject({ type: 'done', stopReason: 'max_iterations' });
  });

  it('answers a tool call that leaked into the text, the model calls again', async () => {
    const leaked = 'Let me read it.<minimax:tool_call><invoke name="read_file"><parameter name="path">src/math.ts</parameter></invoke></minimax:tool_call>';
    const trace = await runScenario({
      files: { 'src/math.ts': APP },
      prompt: 'What does add do?',
      steps: [
        say(leaked),
        (request) => {
          const last = request.messages.at(-1)!;
          const text = last.content.map((block) => (block.type === 'text' ? block.text : '')).join('');
          if (last.role !== 'user' || last.content.some((block) => block.type === 'tool_result') || !/read_file/.test(text)) {
            throw new Error(`the leak was not answered: ${text}`);
          }
          return call({ name: 'read_file', input: { path: 'src/math.ts' } })(request);
        },
        say('add subtracts b from a.')
      ]
    });
    expect(trace.tools.map((record) => record.name)).toEqual(['read_file']);
    expect(stopsWith(trace, 'end_turn')).toEqual([]);
  });

  it('ends the turn after two leaked calls in a row instead of looping', async () => {
    const leaked = '<minimax:tool_call><invoke name="read_file"></invoke></minimax:tool_call>';
    const trace = await runScenario({
      files: { 'a.ts': '' },
      prompt: 'Read',
      steps: [say(leaked), say(leaked), say(leaked), say('unreachable')]
    });
    expect(trace.model.requests).toHaveLength(3);
    expect(stopsWith(trace, 'end_turn')).toEqual([]);
  });

  it('respects plan mode: no write is offered, asked or run', async () => {
    const trace = await runScenario({
      files: { 'src/math.ts': APP },
      prompt: 'Fix add',
      mode: 'plan',
      steps: [
        call({ name: 'read_file', input: { path: 'src/math.ts' } }),
        call({ name: 'write_file', input: { path: 'src/math.ts', content: 'broken' } }),
        expectResult((_, isError) => isError, say('Plan: change "-" to "+" in add.'))
      ]
    });
    expect(respectsPlanMode(trace)).toEqual([]);
    expect(trace.file('src/math.ts')).toBe(APP);
  });

  it('keeps the file when the reader denies the edit and tells the model', async () => {
    const trace = await runScenario({
      files: { 'src/math.ts': APP },
      prompt: 'Fix add',
      deny: true,
      steps: [
        call({ name: 'read_file', input: { path: 'src/math.ts' } }),
        call({ name: 'edit_file', input: { path: 'src/math.ts', old_string: 'return a - b;', new_string: 'return a + b;' } }),
        expectResult((_, isError) => isError, say('The edit was declined, nothing changed.'))
      ]
    });
    expect(trace.approvals).toHaveLength(1);
    expect(trace.file('src/math.ts')).toBe(APP);
    expect(stopsWith(trace, 'end_turn')).toEqual([]);
  });
});
