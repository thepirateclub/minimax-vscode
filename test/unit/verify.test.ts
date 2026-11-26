import { describe, expect, it } from 'vitest';
import { canFixAgain, exitCodeOf, shouldVerify, verifyPrompt } from '../../src/agent/verify';

const base = {
  command: 'npm test',
  changed: true,
  stopped: false,
  failed: false,
  mode: 'code',
  round: 0,
  maxRounds: 2
};

describe('the check of the project after a turn', () => {
  it('runs after a turn of code that changed files', () => {
    expect(shouldVerify(base)).toBe(true);
  });

  it('stays quiet without a command, without changes, after a stop or a failure, in plan', () => {
    expect(shouldVerify({ ...base, command: '  ' })).toBe(false);
    expect(shouldVerify({ ...base, changed: false })).toBe(false);
    expect(shouldVerify({ ...base, stopped: true })).toBe(false);
    expect(shouldVerify({ ...base, failed: true })).toBe(false);
    expect(shouldVerify({ ...base, mode: 'plan' })).toBe(false);
  });

  it('bounds the rounds of fixes', () => {
    expect(canFixAgain({ round: 0, maxRounds: 2 })).toBe(true);
    expect(canFixAgain({ round: 2, maxRounds: 2 })).toBe(false);
    expect(canFixAgain({ round: 0, maxRounds: 0 })).toBe(false);
  });

  it('reads the exit code and gives the tail of the output to the agent', () => {
    expect(exitCodeOf('FAIL a.test.ts\n[exit code 1]')).toBe(1);
    expect(exitCodeOf('ok\n[exit code 0]\n')).toBe(0);
    expect(exitCodeOf('no code')).toBeUndefined();
    const prompt = verifyPrompt('npm test', 'x'.repeat(10_000) + 'THE ERROR');
    expect(prompt).toContain('`npm test` failed');
    expect(prompt).toContain('THE ERROR');
    expect(prompt.length).toBeLessThan(7000);
  });
});
