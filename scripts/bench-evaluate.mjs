#!/usr/bin/env node
/**
 * Throughput benchmark for `evaluate()` — the only function on the SDK's hot path.
 *
 * C10, same as generate-vectors.mjs: lives at the repo ROOT and imports the BUILT
 * `packages/core/dist/**` output, never `src/`. That package has zero runtime
 * dependencies and performs no IO, so Node-executable tooling must sit outside it,
 * and benchmarking the shipped bytes is the only number worth publishing.
 *
 * No `Math.random()`: every unit id comes from the same seeded 32-bit LCG the golden
 * vectors use, so two runs on the same machine measure the same work. The reported
 * figure is the MEDIAN of `ROUNDS` rounds, not the mean — one GC pause during a run
 * should not move the published number.
 *
 * Usage: pnpm bench:evaluate [--json]
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem } from 'node:os';

const CORE_DIST = new URL('../packages/core/dist/index.js', import.meta.url);
if (!existsSync(fileURLToPath(CORE_DIST))) {
  console.error('packages/core/dist is missing — run `pnpm build` first.');
  process.exit(1);
}

const { evaluate } = await import(CORE_DIST.href);

const ITERATIONS = 200_000;
const WARMUP_ITERATIONS = 50_000;
const ROUNDS = 7;

/** `s = (s * 1664525 + 1013904223) mod 2^32` — the LCG generate-vectors.mjs uses. */
function makeLcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/**
 * A fixed pool of unit ids, cycled through by index. Generating ids inside the
 * measured loop would benchmark string formatting, not evaluation.
 */
function unitIdPool(size) {
  const lcg = makeLcg(0x5eed);
  return Array.from({ length: size }, () => `unit-${lcg().toString(16)}`);
}

const UNIT_IDS = unitIdPool(1024);

function flag(overrides = {}) {
  return {
    key: 'checkout-v2',
    environment: 'production',
    archived: false,
    enabled: true,
    onValue: true,
    offValue: false,
    rollout: 50,
    salt: 'salt-1',
    rules: [],
    overrides: {},
    ...overrides,
  };
}

/** Eight rules where the seventh matches — the worst realistic ordered-scan cost. */
const EIGHT_RULES = Array.from({ length: 8 }, (_, i) => ({
  attribute: 'plan',
  operator: 'in',
  values: [`tier-${String(i)}`],
  serve: true,
  rollout: 100,
}));
EIGHT_RULES[6] = {
  attribute: 'plan',
  operator: 'in',
  values: ['pro'],
  serve: true,
  rollout: 100,
};

const ATTRIBUTES_PRO = { plan: 'pro' };
const NO_ATTRIBUTES = {};

/**
 * Each case is `[label, definition, attributes, expectedReason]`. The expected
 * reason is asserted once before measuring: a benchmark of the wrong branch is
 * worse than no benchmark, and this is how a rule reorder gets caught.
 */
const CASES = [
  ['flag not found (server never reached)', undefined, NO_ATTRIBUTES, 'FLAG_NOT_FOUND'],
  ['kill switch off', flag({ enabled: false }), NO_ATTRIBUTES, 'FLAG_OFF'],
  ['per-unit override hit', flag({ overrides: { OVERRIDDEN: true } }), NO_ATTRIBUTES, 'OVERRIDE'],
  ['no rules, 50% rollout (hashes)', flag(), NO_ATTRIBUTES, 'FALLTHROUGH_ROLLOUT'],
  ['8 rules, 7th matches', flag({ rules: EIGHT_RULES }), ATTRIBUTES_PRO, 'RULE_MATCH:6'],
];

/** Returns nanoseconds per evaluation for one round. */
function measure(definition, attributes, iterations) {
  const started = process.hrtime.bigint();
  let sink = 0;
  for (let i = 0; i < iterations; i++) {
    const unitId = UNIT_IDS[i & 1023];
    // `sink` keeps the result observable so the call cannot be optimised away.
    const evaluation = evaluate(definition, { unitId, attributes, defaultValue: false });
    if (evaluation.value) sink++;
  }
  const elapsedNs = Number(process.hrtime.bigint() - started);
  if (sink < 0) throw new Error('unreachable');
  return elapsedNs / iterations;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

const results = [];
for (const [label, definition, attributes, expectedReason] of CASES) {
  // The override case needs the unit id the override is keyed on; every other
  // case cycles the pool. Asserting the reason first pins the measured branch.
  const probeUnitId = expectedReason === 'OVERRIDE' ? 'OVERRIDDEN' : UNIT_IDS[0];
  const probe = evaluate(definition, {
    unitId: probeUnitId,
    attributes,
    defaultValue: false,
  });
  if (expectedReason === 'OVERRIDE') {
    if (probe.reason !== 'OVERRIDE') {
      throw new Error(`case "${label}" expected OVERRIDE, measured ${probe.reason}`);
    }
    // Re-key the override onto every pooled id so the measured loop stays on
    // the override branch instead of falling through to the rollout.
    definition.overrides = Object.fromEntries(UNIT_IDS.map((id) => [id, true]));
  } else if (probe.reason !== expectedReason) {
    throw new Error(`case "${label}" expected ${expectedReason}, measured ${probe.reason}`);
  }

  measure(definition, attributes, WARMUP_ITERATIONS);
  const rounds = Array.from({ length: ROUNDS }, () => measure(definition, attributes, ITERATIONS));
  const nsPerOp = median(rounds);
  results.push({ label, nsPerOp, opsPerSecond: Math.round(1e9 / nsPerOp) });
}

const environment = {
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  cpu: cpus()[0]?.model ?? 'unknown',
  memoryGiB: Math.round(totalmem() / 1024 ** 3),
  iterations: ITERATIONS,
  rounds: ROUNDS,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ environment, results }, null, 2));
} else {
  console.log(
    `evaluate() — median of ${String(ROUNDS)} rounds x ${ITERATIONS.toLocaleString('en-US')} iterations`,
  );
  console.log(`${environment.cpu}, Node ${environment.node}, ${environment.platform}\n`);
  const width = Math.max(...results.map((r) => r.label.length));
  for (const { label, nsPerOp, opsPerSecond } of results) {
    console.log(
      `${label.padEnd(width)}  ${nsPerOp.toFixed(0).padStart(4)} ns/op  ` +
        `${opsPerSecond.toLocaleString('en-US').padStart(12)} ops/s`,
    );
  }
}
