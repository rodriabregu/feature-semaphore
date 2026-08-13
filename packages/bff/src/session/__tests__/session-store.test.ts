import { describe, expect, it } from 'vitest';
import { createMemorySessionStore } from '../session-store.js';

describe('createMemorySessionStore', () => {
  it('row 7: find() is present at expiresAt-1ms and absent at expiresAt exactly, off a frozen clock', () => {
    const store = createMemorySessionStore(1000);
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const record = store.create(createdAt);
    expect(record.expiresAt.getTime()).toBe(createdAt.getTime() + 1000);

    const justBefore = new Date(record.expiresAt.getTime() - 1);
    expect(store.find(record.id, justBefore)).toEqual(record);

    const exactly = new Date(record.expiresAt.getTime());
    expect(store.find(record.id, exactly)).toBeUndefined();
  });

  it('row 8: an expired record is deleted by the find() that observes it', () => {
    const store = createMemorySessionStore(1000);
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const record = store.create(createdAt);
    const atExpiry = new Date(record.expiresAt.getTime());

    expect(store.find(record.id, atExpiry)).toBeUndefined();
    // A second find(), even at the same instant, must observe an empty store —
    // proving deletion happened on the observing call, not a lazy re-check.
    expect(store.find(record.id, new Date(atExpiry.getTime() - 10_000))).toBeUndefined();
  });

  it('row 9: revoke() makes a live id immediately unusable', () => {
    const store = createMemorySessionStore();
    const now = new Date('2026-01-01T00:00:00.000Z');
    const record = store.create(now);

    store.revoke(record.id);

    expect(store.find(record.id, now)).toBeUndefined();
  });

  it('row 10: two create() calls return different ids, each decoding to 32 bytes', () => {
    const store = createMemorySessionStore();
    const now = new Date('2026-01-01T00:00:00.000Z');

    const a = store.create(now);
    const b = store.create(now);

    expect(a.id).not.toBe(b.id);
    expect(Buffer.from(a.id, 'base64url')).toHaveLength(32);
    expect(Buffer.from(b.id, 'base64url')).toHaveLength(32);
  });
});
