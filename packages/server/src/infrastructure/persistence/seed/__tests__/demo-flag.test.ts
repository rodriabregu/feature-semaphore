import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryFlagRepository } from '../../memory/flag-repository.memory.js';
import { MemoryDatabase } from '../../memory/store.js';
import { DEMO_FLAG_KEY, seedDemoFlag } from '../demo-flag.js';

describe('seedDemoFlag', () => {
  const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
  const previousEnv = process.env.SEED_DEMO_FLAG;

  afterEach(() => {
    if (previousEnv === undefined) {
      delete process.env.SEED_DEMO_FLAG;
    } else {
      process.env.SEED_DEMO_FLAG = previousEnv;
    }
  });

  describe('when SEED_DEMO_FLAG is not set to the exact string "true"', () => {
    it.each([
      ['unset', undefined],
      ['false', 'false'],
      ['empty string', ''],
    ])('does not create a flag for %s', async (_label, value) => {
      if (value === undefined) {
        delete process.env.SEED_DEMO_FLAG;
      } else {
        process.env.SEED_DEMO_FLAG = value;
      }
      const db = new MemoryDatabase();
      const repo = createMemoryFlagRepository({ get: () => db.current }, clock);

      await seedDemoFlag(repo, clock);

      expect(await repo.findAllEnvironmentsByKey(DEMO_FLAG_KEY)).toBeNull();
    });
  });

  describe('when SEED_DEMO_FLAG=true', () => {
    beforeEach(() => {
      process.env.SEED_DEMO_FLAG = 'true';
    });

    it('called twice leaves exactly one flag', async () => {
      const db = new MemoryDatabase();
      const repo = createMemoryFlagRepository({ get: () => db.current }, clock);

      await seedDemoFlag(repo, clock);
      await seedDemoFlag(repo, clock);

      const flag = await repo.findAllEnvironmentsByKey(DEMO_FLAG_KEY);
      expect(flag).not.toBeNull();
      expect(await repo.listAllEnvironments()).toHaveLength(1);
    });

    it('the seeded flag is visible via listAllEnvironments with both environments configured', async () => {
      const db = new MemoryDatabase();
      const repo = createMemoryFlagRepository({ get: () => db.current }, clock);

      await seedDemoFlag(repo, clock);

      const flags = await repo.listAllEnvironments();
      expect(flags).toHaveLength(1);
      expect(flags[0]?.flag.key).toBe(DEMO_FLAG_KEY);
      expect(flags[0]?.environments.development).toBeDefined();
      expect(flags[0]?.environments.production).toBeDefined();
    });
  });
});
