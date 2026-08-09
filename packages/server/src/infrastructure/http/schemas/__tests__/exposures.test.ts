import { describe, expect, it } from 'vitest';
import { makeExposuresQuery, MAX_LOOKBACK_MS } from '../exposures.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('makeExposuresQuery', () => {
  it('rejects a missing env', () => {
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const result = makeExposuresQuery(clock).safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects env: "staging" — 400, never 403', () => {
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const result = makeExposuresQuery(clock).safeParse({ env: 'staging' });

    expect(result.success).toBe(false);
  });

  it('an absent since resolves to exactly clock.now() - 24h off an off-hour fake clock (schema layer, not the response echo)', () => {
    const clock = { now: () => new Date('2026-01-01T10:30:00Z') };
    const result = makeExposuresQuery(clock).safeParse({ env: 'development' });

    expect(result.success).toBe(true);
    expect(result.data?.since.getTime()).toBe(new Date('2026-01-01T10:30:00Z').getTime() - DAY_MS);
  });

  it('since 31 days back is rejected at path since; 29 days back parses', () => {
    const clock = { now: () => new Date('2026-01-31T00:00:00Z') };
    const thirtyOneDaysBack = new Date(clock.now().getTime() - 31 * DAY_MS).toISOString();
    const twentyNineDaysBack = new Date(clock.now().getTime() - 29 * DAY_MS).toISOString();

    const rejected = makeExposuresQuery(clock).safeParse({
      env: 'development',
      since: thirtyOneDaysBack,
    });
    expect(rejected.success).toBe(false);
    expect(rejected.error?.issues[0]?.path).toEqual(['since']);

    const accepted = makeExposuresQuery(clock).safeParse({
      env: 'development',
      since: twentyNineDaysBack,
    });
    expect(accepted.success).toBe(true);
  });

  it('since in the future is rejected at path since', () => {
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const future = new Date(clock.now().getTime() + 60_000).toISOString();

    const result = makeExposuresQuery(clock).safeParse({ env: 'development', since: future });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['since']);
  });

  it('rejects an unknown query parameter, matching auditQuery’s .strict()', () => {
    const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
    const result = makeExposuresQuery(clock).safeParse({ env: 'development', limit: 10 });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe('unrecognized_keys');
  });

  it('MAX_LOOKBACK_MS is exactly 30 days', () => {
    expect(MAX_LOOKBACK_MS).toBe(30 * DAY_MS);
  });
});
