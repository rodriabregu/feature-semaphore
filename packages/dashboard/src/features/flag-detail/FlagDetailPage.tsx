import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useFlagQuery } from '../../api/queries/flag.js';
import {
  useVersionedMutation,
  type ConfigRef,
} from '../../api/mutations/use-versioned-mutation.js';
import { ApiError } from '../../api/client.js';
import type { Environment, FlagEnvironmentWire } from '../../api/types.js';
import { EnabledToggle } from './EnabledToggle.js';
import { RolloutSlider } from './RolloutSlider.js';
import { RuleEditor } from './RuleEditor.js';
import { OverrideEditor } from './OverrideEditor.js';
import { confirmationFor } from './confirmation-for.js';
import { ConfirmDialog } from '../../components/molecules/ConfirmDialog.js';
import { TypeToConfirmDialog } from '../../components/molecules/TypeToConfirmDialog.js';

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

function configPath(ref: ConfigRef): string {
  return `/api/flags/${ref.flagKey}/config/${ref.environment}`;
}

interface EnvironmentSectionProps {
  readonly flagKey: string;
  readonly environment: Environment;
  readonly config: FlagEnvironmentWire;
}

/**
 * One environment's controls, all wired through `useVersionedMutation` —
 * the one mutation pattern (design D4) — and gated by `confirmationFor`
 * (D4b/D5b): a production `enabled` toggle requires typing the exact flag
 * key via `TypeToConfirmDialog`; a production rollout change requires
 * confirming a `ConfirmDialog`; development never confirms. The ordered
 * rule editor and override editor (D5) are mounted here per environment,
 * each gating its own Save the same way (`confirmationFor` inside
 * `RuleEditor`/`OverrideEditor`).
 */
function EnvironmentSection({
  flagKey,
  environment,
  config,
}: EnvironmentSectionProps): ReactElement {
  const toggleEnabled = useVersionedMutation<{ enabled: boolean }>(
    { flagKey, environment },
    { method: 'PATCH', path: configPath },
  );
  const setRollout = useVersionedMutation<{ rollout_percentage: number }>(
    { flagKey, environment },
    { method: 'PATCH', path: configPath },
  );

  // `undefined` means no confirmation is pending — the dialog stays closed.
  const [pendingEnabled, setPendingEnabled] = useState<boolean | undefined>(undefined);
  const [pendingRollout, setPendingRollout] = useState<number | undefined>(undefined);

  const toggleTier = confirmationFor(environment, 'toggle');
  const rolloutTier = confirmationFor(environment, 'rollout');

  const conflict = [toggleEnabled.error, setRollout.error].find(
    (error): error is ApiError => error instanceof ApiError && error.problem.status === 412,
  );

  return (
    <section aria-label={environment}>
      <h2>{environment}</h2>
      <EnabledToggle
        id={`enabled-${flagKey}-${environment}`}
        label={`Enabled — ${environment}`}
        checked={config.enabled}
        onChange={(enabled) => {
          if (toggleTier === 'none') {
            toggleEnabled.mutate({ enabled });
          } else {
            setPendingEnabled(enabled);
          }
        }}
      />
      <RolloutSlider
        id={`rollout-${flagKey}-${environment}`}
        label={`Rollout percentage — ${environment}`}
        value={config.rollout_percentage}
        onCommit={(rolloutPercentage) => {
          if (rolloutTier === 'none') {
            setRollout.mutate({ rollout_percentage: rolloutPercentage });
          } else {
            setPendingRollout(rolloutPercentage);
          }
        }}
      />
      <RuleEditor flagKey={flagKey} environment={environment} rules={config.rules} />
      <OverrideEditor flagKey={flagKey} environment={environment} overrides={config.overrides} />
      {conflict ? (
        <p role="alert">
          Conflict: expected v{String(conflict.problem.expectedVersion ?? '?')}, actual v
          {String(conflict.problem.actualVersion ?? '?')}
        </p>
      ) : null}
      <TypeToConfirmDialog
        open={pendingEnabled !== undefined}
        flagKey={flagKey}
        environment={environment}
        targetStateLabel={pendingEnabled ? 'Enabled' : 'Disabled'}
        onConfirm={() => {
          if (pendingEnabled !== undefined) {
            toggleEnabled.mutate({ enabled: pendingEnabled });
          }
          setPendingEnabled(undefined);
        }}
        onCancel={() => {
          setPendingEnabled(undefined);
        }}
      />
      <ConfirmDialog
        open={pendingRollout !== undefined}
        flagKey={flagKey}
        environment={environment}
        targetStateLabel={`${pendingRollout ?? 0}% rollout`}
        onConfirm={() => {
          if (pendingRollout !== undefined) {
            setRollout.mutate({ rollout_percentage: pendingRollout });
          }
          setPendingRollout(undefined);
        }}
        onCancel={() => {
          setPendingRollout(undefined);
        }}
      />
    </section>
  );
}

/**
 * Container (D4a): the flag detail read view, `enabled` toggle, and rollout
 * slider for both environments. Fetches once via `useFlagQuery`, which
 * populates the exact cache entry `useVersionedMutation` reads its version
 * from.
 */
export function FlagDetailPage(): ReactElement {
  const { flagKey } = useParams<'flagKey'>();
  const flagQuery = useFlagQuery(flagKey ?? '');

  if (flagKey === undefined) {
    return <p role="alert">No flag selected.</p>;
  }
  if (flagQuery.isPending) {
    return <p>Loading flag…</p>;
  }
  if (flagQuery.isError) {
    return <p role="alert">Failed to load flag.</p>;
  }

  const flag = flagQuery.data;
  return (
    <>
      <h1>{flag.key}</h1>
      {ENVIRONMENTS.map((environment) => (
        <EnvironmentSection
          key={environment}
          flagKey={flag.key}
          environment={environment}
          config={flag.environments[environment]}
        />
      ))}
    </>
  );
}
