import { randomBytes } from 'node:crypto';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type { Clock } from '../ports/clock.js';
import type { FlagWithAllEnvironments, NewFlag, NewFlagConfig } from '../ports/flag-repository.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

export interface CreateFlagCommand {
  readonly input: NewFlag;
  readonly actor: string;
}

/**
 * Creates a flag with both environment configs in one transaction, then writes
 * exactly one audit entry (`before: null`, flag-scoped — `environment: null`).
 * `on_value` is set explicitly to `true` on both configs so it appears in the
 * audit `after` snapshot, never relying on the column default. A fresh CSPRNG
 * `salt` per environment is generated HERE, never client-supplied.
 */
export async function createFlag(
  uow: UnitOfWork,
  clock: Clock,
  command: CreateFlagCommand,
): Promise<FlagWithAllEnvironments> {
  return uow.transact(async (ctx) => {
    const configs: readonly NewFlagConfig[] = ENVIRONMENTS.map((environment) => ({
      environment,
      enabled: false,
      offValue: false,
      onValue: true, // explicit — never relies on the column default
      rolloutPercentage: 0,
      salt: randomBytes(16).toString('hex'),
    }));

    const created = await ctx.flags.createFlag(command.input, configs);

    await ctx.audit.record({
      actor: command.actor,
      flagKey: command.input.key,
      environment: null,
      action: 'flag.created',
      before: null,
      after: created,
      createdAt: clock.now(),
    });

    return created;
  });
}
