/**
 * Wire types shared across the dashboard's queries, mutations, and screens
 * (design D4). These mirror the server's actual response shapes exactly —
 * `packages/server/src/infrastructure/http/mappers/flag-response.ts` for
 * `FlagWire`, `.../routes/exposures.routes.ts` for the exposures totals shape
 * — so a drift on either side becomes a type error here, not a silent bug.
 */
import type { AttributeValue, EvaluationReason } from '@rodriab/feature-semaphore-core';

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

/**
 * The optional overlay `POST /evaluate/preview` applies over the flag's
 * saved config, letting an operator preview unsaved rule/rollout edits
 * (design D6). Every field optional, mirroring the server's `candidateBody`
 * schema (`packages/server/.../schemas/evaluate.ts`) exactly.
 */
export interface PreviewCandidateBody {
  readonly enabled?: boolean;
  readonly on_value?: boolean;
  readonly off_value?: boolean;
  readonly rollout_percentage?: number;
  readonly rules?: readonly RuleWire[];
  readonly overrides?: readonly { readonly unit_id: string; readonly serve: boolean }[];
}

/** `POST /evaluate/preview` request body — mirrors `previewBody` server-side. */
export interface PreviewRequestBody {
  readonly flag_key: string;
  readonly environment: Environment;
  readonly context: {
    readonly unit_id: string;
    readonly attributes: Readonly<Record<string, AttributeValue>>;
    readonly default_value: boolean;
  };
  readonly candidate?: PreviewCandidateBody;
}

/**
 * `POST /evaluate/preview` response shape. `reason` is the core's own
 * `EvaluationReason` union — imported, never re-declared, so a new reason
 * added to the evaluation kernel is a type error here rather than silently
 * unhandled (design D6, ladder row 60).
 */
export interface PreviewResponse {
  readonly value: boolean;
  readonly reason: EvaluationReason;
  readonly flag_key: string;
  readonly environment: Environment;
  readonly candidate_applied: boolean;
}

/**
 * `GET /flags/:key/audit` entry shape — camelCase, mirroring
 * `packages/server/src/application/ports/audit-log.ts`'s `AuditEntry`
 * verbatim, since the route sends `{ entries }` with zero mapping (design
 * D7). `actor` is an opaque `api_keys.id` (audit-log.ts:7) — never a human
 * name, never rendered as one. `before`/`after` are full untyped snapshots.
 */
export interface AuditEntryWire {
  readonly actor: string;
  readonly flagKey: string;
  readonly environment: Environment | null;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly createdAt: string;
}

/** `GET /flags/:key/audit` response shape — `{ entries: [...] }`. */
export interface AuditResponse {
  readonly entries: readonly AuditEntryWire[];
}
