/**
 * Wire types shared across the dashboard's queries, mutations, and screens
 * (design D4). These mirror the server's actual response shapes exactly —
 * `packages/server/src/infrastructure/http/mappers/flag-response.ts` for
 * `FlagWire`, `.../routes/exposures.routes.ts` for the exposures totals shape
 * — so a drift on either side becomes a type error here, not a silent bug.
 */

export type Environment = 'development' | 'production';

export interface RuleWire {
  readonly attribute: string;
  readonly operator: string;
  readonly values: readonly unknown[];
  readonly serve: boolean;
  readonly rollout: number;
}

export interface FlagEnvironmentWire {
  readonly enabled: boolean;
  readonly off_value: unknown;
  readonly on_value: unknown;
  readonly rollout_percentage: number;
  readonly salt: string;
  readonly updated_at: string;
  readonly version: number;
  readonly rules: readonly RuleWire[];
  readonly overrides: Readonly<Record<string, boolean>>;
}

export interface FlagWire {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly archived: boolean;
  readonly environments: {
    readonly development: FlagEnvironmentWire;
    readonly production: FlagEnvironmentWire;
  };
}

/** `GET /api/flags` response shape — `{ flags: [...] }`, never a bare array. */
export interface FlagListResponse {
  readonly flags: readonly FlagWire[];
}

/** `GET /api/exposures?env=...` response shape (bulk, per-flag totals). */
export interface ExposuresTotalsResponse {
  readonly environment: Environment;
  readonly since: string;
  readonly flags: readonly { readonly flag_key: string; readonly total: number }[];
}
