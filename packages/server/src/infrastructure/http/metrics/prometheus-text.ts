/**
 * Hand-rolled Prometheus text exposition formatter (design D6/§7,§9).
 * `prom-client` is deliberately out — its global registry fights this repo's
 * dependency-injection style (composition-root builds and injects every
 * adapter explicitly; a module-level singleton registry would be the one
 * exception). This module knows nothing about WHERE values come from — it
 * only renders `# HELP`/`# TYPE` lines and per-sample lines from data callers
 * already computed.
 */

export interface MetricSample {
  /** Overrides the family's `name` for this one sample — histogram families
   * need `_bucket`/`_sum`/`_count` suffixed names sharing one HELP/TYPE block. */
  readonly name?: string;
  readonly labels?: Readonly<Record<string, string>>;
  readonly value: number;
}

export interface MetricFamily {
  readonly name: string;
  readonly help: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
  readonly samples: readonly MetricSample[];
}

/**
 * Prometheus exposition format label-value escaping: backslash first (or a
 * literal backslash in the input would be double-escaped by the quote/newline
 * replacements that follow it), then double-quote, then newline as the
 * two-character sequence `\n` (not a real line break).
 */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: Readonly<Record<string, string>> | undefined): string {
  if (!labels) return '';
  const entries = Object.entries(labels);
  if (entries.length === 0) return '';
  const rendered = entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',');
  return `{${rendered}}`;
}

export function formatMetrics(families: readonly MetricFamily[]): string {
  const lines: string[] = [];
  for (const family of families) {
    lines.push(`# HELP ${family.name} ${family.help}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);
    for (const sample of family.samples) {
      const name = sample.name ?? family.name;
      lines.push(`${name}${formatLabels(sample.labels)} ${sample.value}`);
    }
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}
