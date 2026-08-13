import { randomBytes } from 'node:crypto';

export interface SessionRecord {
  readonly id: string;
  readonly expiresAt: Date;
}

export interface SessionStore {
  /** 256 bits of `randomBytes`, base64url — meaningless without the store. */
  create(now: Date): SessionRecord;
  /** Lazy expiry: an expired record is DELETED here and reported absent. */
  find(id: string, now: Date): SessionRecord | undefined;
  /**
   * Real revocation — why a stateless signed cookie was rejected (design D2),
   * and the mechanism behind "logout then access denied" (row 24).
   */
  revoke(id: string): void;
}

/** `[I]` 8h, absolute — never sliding, so a forgotten open tab is not privileged indefinitely. */
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * In-memory `Map` over an opaque random id. Chosen over a signed stateless
 * cookie so `revoke()` can be real revocation (design D2) — the mechanism
 * `#1894`'s "Logout then access denied" scenario requires. Restart logs
 * everyone out: a feature for a single-tenant admin tool, not a defect.
 */
export function createMemorySessionStore(ttlMs: number = SESSION_TTL_MS): SessionStore {
  const sessions = new Map<string, SessionRecord>();

  return {
    create(now: Date): SessionRecord {
      const id = randomBytes(32).toString('base64url');
      const record: SessionRecord = { id, expiresAt: new Date(now.getTime() + ttlMs) };
      sessions.set(id, record);
      return record;
    },

    find(id: string, now: Date): SessionRecord | undefined {
      const record = sessions.get(id);
      if (!record) return undefined;
      if (now.getTime() >= record.expiresAt.getTime()) {
        sessions.delete(id);
        return undefined;
      }
      return record;
    },

    revoke(id: string): void {
      sessions.delete(id);
    },
  };
}
