import { buildSnapshot, type SnapshotBox } from './snapshot-store.js';
import type { Clock } from './ports/clock.js';
import type { Cancel, Scheduler } from './ports/scheduler.js';
import type { Transport } from './ports/transport.js';

export interface PollerOptions {
  readonly transport: Pick<Transport, 'fetchDefinitions'>;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly box: SnapshotBox;
  /** Default 30s. */
  readonly intervalMs?: number;
  /** Called on a failed refresh — logging is the caller's concern, not the poller's. */
  readonly onError?: (error: unknown) => void;
  /** Called once a snapshot has been installed (bootstrap or a successful fetch). */
  readonly onSnapshotReady?: () => void;
}

/**
 * ETag stale-while-revalidate: 200 swaps the snapshot atomically, 304
 * advances only `fetchedAt`, and a throw KEEPS the current snapshot and
 * reports it via `onError` — the server being unreachable never blanks out
 * data the client already has. One fetch in flight at a time; a tick
 * arriving during a fetch is skipped, never queued.
 */
export function startPoller(options: PollerOptions): Cancel {
  let inFlight = false;

  const tick = (): void => {
    if (inFlight) return;
    inFlight = true;
    // poll() never rejects — it reports failures via onError internally —
    // but .finally() alone still needs a promise to attach to.
    void poll(options).finally(() => {
      inFlight = false;
    });
  };

  return options.scheduler.every(options.intervalMs ?? 30_000, tick);
}

async function poll(options: PollerOptions): Promise<void> {
  const current = options.box.get();

  try {
    const response = await options.transport.fetchDefinitions(
      current?.etag,
      new AbortController().signal,
    );

    if (response.status === 304) {
      if (current) {
        options.box.set({ ...current, fetchedAt: options.clock.now() });
      }
      options.onSnapshotReady?.();
      return;
    }

    options.box.set(
      buildSnapshot(response.definitions, response.etag, response.environment, options.clock.now()),
    );
    options.onSnapshotReady?.();
  } catch (error) {
    // Keep the current snapshot — stale-while-revalidate. The caller logs.
    options.onError?.(error);
  }
}
