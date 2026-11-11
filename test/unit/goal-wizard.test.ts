import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GOAL_FORM,
  GOAL_STEPS,
  nextStep,
  previousStep,
  stepError
} from '../../src/ui/webview/goalWizard';
import { parseSlashCommand } from '../../src/ui/webview/slashCommand';

describe('the steps of the goal wizard', () => {
  it('goes from the objective to the limits to the review', () => {
    expect(GOAL_STEPS).toEqual(['objective', 'limits', 'review']);
    expect(nextStep('objective')).toBe('limits');
    expect(nextStep('limits')).toBe('review');
    expect(nextStep('review')).toBe('review');
    expect(previousStep('review')).toBe('limits');
    expect(previousStep('objective')).toBe('objective');
  });

  it('does not leave the first step without an objective', () => {
    expect(stepError('objective', { ...DEFAULT_GOAL_FORM, objective: '  ' })).toBe('empty');
    expect(stepError('objective', { ...DEFAULT_GOAL_FORM, objective: 'Ship it' })).toBeUndefined();
  });

  it('does not leave the limits with a wrong number', () => {
    const form = { ...DEFAULT_GOAL_FORM, objective: 'Ship it', tokens: '-5' };
    expect(stepError('limits', form)).toBe('badLimit');
    expect(stepError('limits', { ...form, tokens: '' })).toBeUndefined();
  });
});

describe('the slash command of the goal', () => {
  it('sets the goal with the text after the command', () => {
    expect(parseSlashCommand('/goal Rewrite the parser')).toEqual({
      kind: 'goal',
      objective: 'Rewrite the parser'
    });
  });

  it('opens the wizard without a text', () => {
    expect(parseSlashCommand('/goal')).toEqual({ kind: 'goal', objective: '' });
    expect(parseSlashCommand('  /goal   ')).toEqual({ kind: 'goal', objective: '' });
  });

  it('keeps the lines of a long objective as one line', () => {
    expect(parseSlashCommand('/goal Rewrite\nthe parser')).toEqual({
      kind: 'goal',
      objective: 'Rewrite the parser'
    });
  });

  it('leaves an ordinary request and a look-alike word to the agent', () => {
    expect(parseSlashCommand('Rewrite the parser')).toBeUndefined();
    expect(parseSlashCommand('/goals of the week')).toBeUndefined();
    expect(parseSlashCommand('what is /goal')).toBeUndefined();
  });
});
