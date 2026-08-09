import { evaluate } from '@rodriab/feature-semaphore-core';
import type {
  AttributeValue,
  Environment,
  Evaluation,
  FlagDefinition,
} from '@rodriab/feature-semaphore-core';
import { ExposureBatcher } from './exposure-batcher.js';
import { startPoller } from './poller.js';
import { buildSnapshot, createSnapshotBox, type SnapshotBox } from './snapshot-store.js';
import { createHttpTransport } from './http-transport.js';
import { createTimersScheduler } from './timers-scheduler.js';
import type { Clock } from './ports/clock.js';
import type { Cancel, Scheduler } from './ports/scheduler.js';
import type { Transport } from './ports/transport.js';

export interface Context {
  readonly unitId: string;
  readonly attributes?: Readonly<Record<string, AttributeValue | undefined>>;
}

export interface FlagsClient {
  isEnabled(flagKey: string, context: Context, defaultValue: boolean): boolean;
  getEvaluation(flagKey: string, context: Context, defaultValue: boolean): Evaluation;
  /** Resolves on the first usable snapshot (bootstrap or fetch). NEVER rejects. */
  ready(): Promise<void>;
  /** Flushes pending exposures once, cancels both schedules, then resolves. NEVER rejects. */
  close(): Promise<void>;
}

/** Shaped exactly like `GET /api/v1/sdk/definitions`'s response body. */
export interface BootstrapPayload {
  readonly environment: Environment;
  readonly definitions: readonly FlagDefinition[];
}

export interface ClientOptions {
  /** Injectable for tests; the production default is `createHttpTransport(...)`. */
  readonly transport?: Transport;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly scheduler?: Scheduler;
  readonly clock?: Clock;
  readonly bootstrap?: BootstrapPayload;
  /** Default 30000ms. */
  readonly pollIntervalMs?: number;
  /** Default 5000ms. */
  readonly readyTimeoutMs?: number;
  /** Default 2000ms. */
  readonly closeTimeoutMs?: number;
  /** Default 30000ms. */
  readonly exposureFlushIntervalMs?: number;
  /** Default 500. */
  readonly exposureHighWaterMark?: number;
  /** Default 5000. Bounds DISTINCT keys, not call volume. */
  readonly maxDistinctExposures?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 5000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2000;

function resolveTransport(options: ClientOptions): Transport {
  if (options.transport) return options.transport;
  if (!options.baseUrl || !options.apiKey) {
    throw new Error('createClient requires either a `transport` or both `baseUrl` and `apiKey`');
  }
  return createHttpTransport({ baseUrl: options.baseUrl, apiKey: options.apiKey });
}

function bucketHourIso(clock: Clock): string {
  const now = clock.now();
  const truncated = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()),
  );
  return truncated.toISOString();
}

export function createClient(options: ClientOptions): FlagsClient {
  const clock: Clock = options.clock ?? { now: () => new Date() };
  const scheduler: Scheduler = options.scheduler ?? createTimersScheduler();
  const transport = resolveTransport(options);
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;

  const initialSnapshot = options.bootstrap
    ? buildSnapshot(
        options.bootstrap.definitions,
        undefined,
        options.bootstrap.environment,
        clock.now(),
      )
    : undefined;
  const box: SnapshotBox = createSnapshotBox(initialSnapshot);

  // `resolve()` is idempotent — calling it more than once (bootstrap AND the
  // first successful fetch, or a fetch AND the timeout) is safe by design.
  let resolveReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
    if (initialSnapshot) resolve();
  });

  const readyTimeoutHandle = setTimeout(() => {
    resolveReady();
  }, readyTimeoutMs);
  readyTimeoutHandle.unref();

  const cancelPoll: Cancel = startPoller({
    transport,
    scheduler,
    clock,
    box,
    intervalMs: options.pollIntervalMs,
    onSnapshotReady: resolveReady,
    onError: () => {
      // stale-while-revalidate: the previous snapshot is retained; nothing
      // further to do here besides letting ready() fall back to its timeout.
    },
  });

  const batcher = new ExposureBatcher({
    transport,
    scheduler,
    flushIntervalMs: options.exposureFlushIntervalMs,
    highWaterMark: options.exposureHighWaterMark,
    maxDistinctExposures: options.maxDistinctExposures,
  });

  let closed = false;

  function getEvaluation(flagKey: string, context: Context, defaultValue: boolean): Evaluation {
    const snapshot = box.get();
    let evaluation: Evaluation;
    try {
      const definition = snapshot?.byKey.get(flagKey);
      evaluation = evaluate(definition, {
        unitId: context.unitId,
        attributes: context.attributes ?? {},
        defaultValue,
      });
    } catch {
      evaluation = { value: defaultValue, reason: 'FLAG_NOT_FOUND' };
    }

    if (!closed) {
      batcher.record(
        flagKey,
        snapshot?.environment,
        bucketHourIso(clock),
        evaluation.value,
        evaluation.reason,
      );
    }

    return evaluation;
  }

  return {
    getEvaluation,

    isEnabled(flagKey: string, context: Context, defaultValue: boolean): boolean {
      return getEvaluation(flagKey, context, defaultValue).value;
    },

    ready(): Promise<void> {
      return readyPromise;
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      clearTimeout(readyTimeoutHandle);
      cancelPoll();
      batcher.stop();

      await Promise.race([
        batcher.flush(),
        new Promise<void>((resolve) => {
          const handle = setTimeout(resolve, closeTimeoutMs);
          handle.unref();
        }),
      ]).catch(() => {
        // close() never rejects
      });
    },
  };
}
