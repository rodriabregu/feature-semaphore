import { describe, expect, it } from 'vitest';
import { escapeLabelValue, formatMetrics } from '../prometheus-text.js';

describe('escapeLabelValue', () => {
  it('escapes a backslash as \\\\', () => {
    expect(escapeLabelValue('a\\b')).toBe('a\\\\b');
  });

  it('escapes a double quote as \\"', () => {
    expect(escapeLabelValue('a"b')).toBe('a\\"b');
  });

  it('escapes a newline as the two-character sequence \\n', () => {
    expect(escapeLabelValue('a\nb')).toBe('a\\nb');
  });

  it('escapes all three in one value, backslash first so later escapes are not double-escaped', () => {
    expect(escapeLabelValue('a\\"\n')).toBe('a\\\\\\"\\n');
  });
});

describe('formatMetrics', () => {
  it('renders HELP/TYPE lines and one sample line per family, with escaped label values', () => {
    const text = formatMetrics([
      {
        name: 'feature_semaphore_flag_exposures_total',
        help: 'Cumulative count of flag evaluations.',
        type: 'counter',
        samples: [{ labels: { flag: 'check"out', environment: 'development' }, value: 3 }],
      },
    ]);

    expect(text).toContain('# HELP feature_semaphore_flag_exposures_total Cumulative count of flag evaluations.');
    expect(text).toContain('# TYPE feature_semaphore_flag_exposures_total counter');
    expect(text).toContain(
      'feature_semaphore_flag_exposures_total{flag="check\\"out",environment="development"} 3',
    );
  });

  it('renders a sample with no labels as a bare metric name', () => {
    const text = formatMetrics([
      {
        name: 'feature_semaphore_sdk_definitions_duration_seconds_sum',
        help: 'Sum of observed seconds.',
        type: 'histogram',
        samples: [{ value: 1.5 }],
      },
    ]);

    expect(text).toContain('feature_semaphore_sdk_definitions_duration_seconds_sum 1.5');
  });
});
