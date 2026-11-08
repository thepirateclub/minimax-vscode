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
});
