import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../../src/logger';

describe('redactSecrets', () => {
  it('masks bearer tokens in logs', () => {
    const text = 'Authorization: Bearer sk-abcdef123456';
    expect(redactSecrets(text)).not.toContain('sk-abcdef123456');
    expect(redactSecrets(text)).toContain('Bearer ***');
  });

  it('masks query string tokens', () => {
    expect(redactSecrets('https://api.minimax.io/v1?key=secret-value')).not.toContain('secret-value');
  });

  it('masks the key of the M Plan with dashes and underscores', () => {
    // The format of the key of the plan: sk-c..., dashes and underscores, it
    // is long. The synthetic key holds the shape and no real key.
    const key =
      'sk-cp-9f2aB7xQ1mZ0pL4vR8tY3wK6hD5sN1gJ2kM7xQ4wE9bV6nT8yU0iO3pA5sD7fG9hJ1kL3mN5';
    const text = 'the server said: ' + key;
    expect(redactSecrets(text)).not.toContain(key);
    expect(redactSecrets(text)).toContain('sk-***');
  });

  it('does not mask the words that only carry the letters of the prefix', () => {
    expect(redactSecrets('the task-priority of the work')).toContain('task-priority');
  });
});
