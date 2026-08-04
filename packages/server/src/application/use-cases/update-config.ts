import type { Clock } from '../ports/clock.js';
import type { ConfigPatch, ConfigRef } from '../ports/flag-repository.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface UpdateConfigCommand {
  readonly ref: ConfigRef;
  readonly patch: ConfigPatch;
  readonly expectedVersion: number;
  readonly actor: string;
}

/**
 * Locked read (inside `updateConfig`'s own conditional write) + a `before`
 * snapshot read + the conditional update + one audit entry, all in one
 * transaction. If the update throws (`NotFoundError`/`VersionConflictError`),
 * the whole transaction rolls back and no audit entry is written.
 */
export async function updateConfig(
  uow: UnitOfWork,
  clock: Clock,
  command: UpdateConfigCommand,
): Promise<{ version: number }> {
  return uow.transact(async (ctx) => {
    const before = await ctx.flags.findByKey(command.ref);
    const version = await ctx.flags.updateConfig(
      command.ref,
      command.patch,
      command.expectedVersion,
    );
    const after = await ctx.flags.findByKey(command.ref);

    await ctx.audit.record({
      actor: command.actor,
      flagKey: command.ref.flagKey,
      environment: command.ref.environment,
      action: 'config.updated',
      before,
      after,
      createdAt: clock.now(),
    });

    return { version };
  });
}
