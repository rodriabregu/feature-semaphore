import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time compare over fixed-length SHA-256 digests. Hashing first
 * matters: `timingSafeEqual` throws on a length mismatch, and a naive
 * length pre-check would itself leak the password length through timing.
 * `createHash` is the house idiom, mirrored from
 * `packages/server/src/infrastructure/http/plugins/token-auth.ts:19-21`.
 */
export function comparePassword(submitted: string, configured: string): boolean {
  const submittedHash = createHash('sha256').update(submitted, 'utf8').digest();
  const configuredHash = createHash('sha256').update(configured, 'utf8').digest();
  return timingSafeEqual(submittedHash, configuredHash);
}
