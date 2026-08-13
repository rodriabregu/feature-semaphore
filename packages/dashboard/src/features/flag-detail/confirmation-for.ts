import type { Environment } from '../../api/types.js';

export type ConfirmationAction = 'toggle' | 'rollout' | 'rules' | 'overrides';
export type ConfirmationTier = 'type-key' | 'modal' | 'none';

/**
 * Tiered production confirmation (`#1893`, spec "Tiered production
 * confirmation", design D4). The kill switch (`toggle`) has instantaneous,
 * total blast radius — that is where friction belongs. Making an operator
 * type a flag key to nudge a rollout five points would be friction without
 * proportion, and friction people learn to click through is worse than none.
 * Development never confirms — there is nothing at stake to protect against.
 */
export function confirmationFor(
  environment: Environment,
  action: ConfirmationAction,
): ConfirmationTier {
  if (environment !== 'production') {
    return 'none';
  }
  return action === 'toggle' ? 'type-key' : 'modal';
}
