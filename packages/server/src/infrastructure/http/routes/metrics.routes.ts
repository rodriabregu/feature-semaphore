import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Environment } from '@rodriab/feature-semaphore-core';
import type { Clock } from '../../../application/ports/clock.js';
import type { ExposureRepository } from '../../../application/ports/exposure-repository.js';
import type { FlagRepository } from '../../../application/ports/flag-repository.js';
import { formatMetrics, type MetricFamily, type MetricSample } from '../metrics/prometheus-text.js';
import type { Histogram } from '../metrics/histogram.js';

export interface MetricsRoutesDeps {
  readonly repo: FlagRepository;
  readonly exposures: ExposureRepository;
  readonly clock: Clock;
  readonly histogram: Histogram;
}

const ENVIRONMENTS: readonly Environment[] = ['development', 'production'];

/**
 * D6: `since` is fixed at the Unix epoch, never a sliding window, so this
 * metric is a genuine cumulative Prometheus counter — its name and its query
 * agree. This is monotonic ONLY because exposure retention is out of scope
 * (settled, `#1978`). If a pruner is ever added, `_total` silently stops being
 * cumulative and every `rate()` computed over it starts lying at prune time.
 */
const EPOCH = new Date(0);

async function buildExposureTotalsFamily(exposures: ExposureRepository): Promise<MetricFamily> {
  const samples: MetricSample[] = [];
  for (const environment of ENVIRONMENTS) {
    const totals = await exposures.listFlagTotals({ environment, since: EPOCH });
    for (const { flagKey, total } of totals) {
      samples.push({ labels: { flag: flagKey, environment }, value: total });
    }
  }
  return {
    name: 'feature_semaphore_flag_exposures_total',
    help: 'Cumulative count of flag evaluations exposed to end users, by flag and environment.',
    type: 'counter',
    samples,
  };
}

async function buildRulesetAgeFamily(repo: FlagRepository, clock: Clock): Promise<MetricFamily> {
  const flags = await repo.listAllEnvironments();
  const now = clock.now().getTime();
  const samples: MetricSample[] = [];
  for (const flagWithEnvironments of flags) {
    for (const environment of ENVIRONMENTS) {
      const { updatedAt } = flagWithEnvironments.environments[environment].config;
      const ageSeconds = (now - updatedAt.getTime()) / 1000;
      samples.push({
        labels: { flag: flagWithEnvironments.flag.key, environment },
        value: ageSeconds,
      });
    }
  }
  return {
    name: 'feature_semaphore_ruleset_age_seconds',
    help: 'Seconds since the ruleset for a flag/environment was last updated.',
    type: 'gauge',
    samples,
  };
}

function buildDefinitionsLatencyFamily(histogram: Histogram): MetricFamily {
  const name = 'feature_semaphore_sdk_definitions_duration_seconds';
  const snapshot = histogram.snapshot();
  const samples: MetricSample[] = [
    ...snapshot.buckets.map((bucket) => ({
      name: `${name}_bucket`,
      labels: { le: String(bucket.le) },
      value: bucket.count,
    })),
    { name: `${name}_bucket`, labels: { le: '+Inf' }, value: snapshot.count },
    { name: `${name}_sum`, value: snapshot.sum },
    { name: `${name}_count`, value: snapshot.count },
  ];
  return {
    name,
    help: 'Latency of GET /api/v1/sdk/definitions responses, in seconds.',
    type: 'histogram',
    samples,
  };
}

/**
 * Registers at the ROOT of the app — a sibling of `/healthz`/`/readyz`,
 * outside the `/api/v1` scope and its `authPlugin` — so `/metrics` is
 * unauthenticated by placement, exactly like `/healthz` (design D6). Callers
 * MUST register this before the `/api/v1` scope, per the comment at the
 * composition-root call site.
 */
export function registerMetricsRoutes(app: FastifyInstance, deps: MetricsRoutesDeps): void {
  app.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    const families = await Promise.all([
      buildExposureTotalsFamily(deps.exposures),
      buildRulesetAgeFamily(deps.repo, deps.clock),
      Promise.resolve(buildDefinitionsLatencyFamily(deps.histogram)),
    ]);

    reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    reply.send(formatMetrics(families));
  });
}
