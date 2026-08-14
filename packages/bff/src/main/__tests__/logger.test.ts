import { afterEach, describe, expect, it } from 'vitest';
import { createBffLogger } from '../logger.js';

describe('createBffLogger — level configurable via LOG_LEVEL (correction, #1988 review)', () => {
  const original = process.env.LOG_LEVEL;

  afterEach(() => {
    if (original === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = original;
  });

  it('defaults to info when LOG_LEVEL is unset', () => {
    delete process.env.LOG_LEVEL;
    expect(createBffLogger().level).toBe('info');
  });

  it('honours LOG_LEVEL when set — the vitest config sets it to silent', () => {
    process.env.LOG_LEVEL = 'warn';
    expect(createBffLogger().level).toBe('warn');
  });
});
