import type { Clock } from '../ports/clock.js';
import type { ConfigRef, NewRule } from '../ports/flag-repository.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface ReplaceRulesCommand {
  readonly ref: ConfigRef;
  readonly rules: readonly NewRule[];
  readonly expectedVersion: number;
  readonly actor: string;
}

/** Whole-set replacement, same version-conflict contract as `updateConfig`. */
export async function replaceRules(
  uow: UnitOfWork,
  clock: Clock,
  command: ReplaceRulesCommand,
): Promise<{ version: number }> {
  return uow.transact(async (ctx) => {
    const before = await ctx.flags.findByKey(command.ref);
    const version = await ctx.flags.replaceRules(
      command.ref,
      command.rules,
      command.expectedVersion,
    );
    const after = await ctx.flags.findByKey(command.ref);

    await ctx.audit.record({
      actor: command.actor,
      flagKey: command.ref.flagKey,
      environment: command.ref.environment,
      action: 'rules.replaced',
      before,
      after,
      createdAt: clock.now(),
    });

    return { version };
  });
}
