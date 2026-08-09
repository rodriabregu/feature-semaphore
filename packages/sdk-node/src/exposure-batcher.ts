import type { Environment, EvaluationReason, FlagValue } from '@rodriab/feature-semaphore-core';
import type { Cancel, Scheduler } from './ports/scheduler.js';
import type { ExposureRecord, Transport } from './ports/transport.js';

interface BufferedEntry {
  readonly flagKey: string;
  readonly value: FlagValue;
  readonly reason: string;
  count: number;
}

export interface ExposureBatcherOptions {
  readonly transport: Pick<Transport, 'sendExposures'>;
  readonly scheduler: Scheduler;
  /** Default 30s — never on the `isEnabled()` path. */
  readonly flushIntervalMs?: number;
  /** Default 500 — the server's own batch cap. */
  readonly highWaterMark?: number;
  /** Default 5000. Bounds DISTINCT keys, not call volume. */
  readonly maxDistinctExposures?: number;
}

/**
 * An aggregating map keyed on the server's own five-tuple
 * `(flagKey, environment, bucketHour, value, reason)`. `environment` and
 * `bucketHour` are partition-only — they are never transmitted; the wire
 * body stays `{flagKey, value, reason, count}`. Bound on DISTINCT keys, not
 * call volume: at the bound, an already-tracked tuple still increments and a
 * new tuple is dropped — the inverse of a drop-oldest queue, which would
 * evict a hot key to admit a cold one.
 */
export class ExposureBatcher {
  readonly #buffer = new Map<string, BufferedEntry>();
  readonly #transport: Pick<Transport, 'sendExposures'>;
  readonly #highWaterMark: number;
  readonly #maxDistinctExposures: number;
  readonly #cancelSchedule: Cancel;
  #flushing = false;

  constructor(options: ExposureBatcherOptions) {
    this.#transport = options.transport;
    this.#highWaterMark = options.highWaterMark ?? 500;
    this.#maxDistinctExposures = options.maxDistinctExposures ?? 5000;
    this.#cancelSchedule = options.scheduler.every(options.flushIntervalMs ?? 30_000, () => {
      void this.flush();
    });
  }

  get size(): number {
    return this.#buffer.size;
  }

  /** Enqueue only — never awaited, never inspected by the caller. */
  record(
    flagKey: string,
    environment: Environment | undefined,
    bucketHourIso: string,
    value: FlagValue,
    reason: EvaluationReason,
  ): void {
    const key = `${flagKey}\0${String(environment)}\0${bucketHourIso}\0${value ? '1' : '0'}\0${reason}`;
    const existing = this.#buffer.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }

    if (this.#buffer.size >= this.#maxDistinctExposures) {
      return; // bound reached: a NEW distinct key is dropped
    }
    this.#buffer.set(key, { flagKey, value, reason, count: 1 });

    if (this.#buffer.size >= this.#highWaterMark) {
      void this.flush();
    }
  }

  /**
   * One flush in flight at a time; a tick arriving during a flush is a
   * no-op. Rows are removed from the buffer BEFORE the transport call so
   * new exposures accumulate into a fresh buffer, never lost or duplicated.
   * On failure the batch is discarded and never retried — retrying an
   * additive counter after an ambiguous failure would double-count.
   */
  async flush(): Promise<void> {
    if (this.#flushing || this.#buffer.size === 0) return;
    this.#flushing = true;
    try {
      const rows: readonly ExposureRecord[] = [...this.#buffer.values()].map((entry) => ({
        flagKey: entry.flagKey,
        value: entry.value,
        reason: entry.reason,
        count: entry.count,
      }));
      this.#buffer.clear();

      try {
        await this.#transport.sendExposures(rows, new AbortController().signal);
      } catch {
        // discard the batch; never retry
      }
    } finally {
      this.#flushing = false;
    }
  }

  /** Cancels the scheduled interval. Does NOT flush — `close()` owns that. */
  stop(): void {
    this.#cancelSchedule();
  }
}
