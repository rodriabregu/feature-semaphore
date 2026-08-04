import type { Clock } from '../ports/clock.js';
import type { ConfigRef, NewOverride } from '../ports/flag-repository.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface ReplaceOverridesCommand {
  readonly ref: ConfigRef;
  readonly overrides: readonly NewOverride[];
  readonly expectedVersion: number;
  readonly actor: string;
}

/** Whole-set replacement, same version-conflict contract as `updateConfig`. */
export async function replaceOverrides(
  uow: UnitOfWork,
  clock: Clock,
  command: ReplaceOverridesCommand,
): Promise<{ version: number }> {
  return uow.transact(async (ctx) => {
    const before = await ctx.flags.findByKey(command.ref);
    const version = await ctx.flags.replaceOverrides(
      command.ref,
      command.overrides,
      command.expectedVersion,
    );
    const after = await ctx.flags.findByKey(command.ref);

    await ctx.audit.record({
      actor: command.actor,
      flagKey: command.ref.flagKey,
      environment: command.ref.environment,
      action: 'overrides.replaced',
      before,
      after,
      createdAt: clock.now(),
    });

    return { version };
  });
}
