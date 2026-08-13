import type { ReactElement } from 'react';
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
 * One environment's controls, both wired through `useVersionedMutation` —
 * the one mutation pattern (design D4). Production's confirmation tiers
 * (D4b) are deliberately NOT built here: this slice only ships the
 * unconfirmed read/toggle/slider path.
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
          toggleEnabled.mutate({ enabled });
        }}
      />
      <RolloutSlider
        id={`rollout-${flagKey}-${environment}`}
        label={`Rollout percentage — ${environment}`}
        value={config.rollout_percentage}
        onCommit={(rolloutPercentage) => {
          setRollout.mutate({ rollout_percentage: rolloutPercentage });
        }}
      />
      {conflict ? (
        <p role="alert">
          Conflict: expected v{String(conflict.problem.expectedVersion ?? '?')}, actual v
          {String(conflict.problem.actualVersion ?? '?')}
        </p>
      ) : null}
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
