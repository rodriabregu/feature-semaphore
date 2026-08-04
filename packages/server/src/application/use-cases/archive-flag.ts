import type { Clock } from '../ports/clock.js';
import type { UnitOfWork } from '../ports/unit-of-work.js';

export interface ArchiveFlagCommand {
  readonly key: string;
  readonly actor: string;
}

/**
 * `archiveFlag` touches `flags`, not `flag_configs` — no config version is
 * bumped, which is why `POST /archive` requires no `If-Match`. One audit
 * entry, flag-scoped (`environment: null`).
 */
export async function archiveFlag(
  uow: UnitOfWork,
  clock: Clock,
  command: ArchiveFlagCommand,
): Promise<void> {
  await uow.transact(async (ctx) => {
    const before = await ctx.flags.findAllEnvironmentsByKey(command.key);
    const at = clock.now();
    await ctx.flags.archiveFlag(command.key, at);
    const after = await ctx.flags.findAllEnvironmentsByKey(command.key);

    await ctx.audit.record({
      actor: command.actor,
      flagKey: command.key,
      environment: null,
      action: 'flag.archived',
      before,
      after,
      createdAt: at,
    });
  });
}
