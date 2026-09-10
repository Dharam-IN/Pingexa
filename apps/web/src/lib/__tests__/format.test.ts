import { describe, expect, it } from 'vitest';
import type { UptimeSummary } from '@pingexa/shared';
import {
  formatDuration,
  formatMs,
  formatRelative,
  formatUptime,
  hostnameOf,
} from '../format';

function summary(overrides: Partial<UptimeSummary> = {}): UptimeSummary {
  return {
    window: '24h',
    windowStart: '2026-09-09T12:00:00.000Z',
    windowEnd: '2026-09-10T12:00:00.000Z',
    upChecks: 288,
    downChecks: 0,
    recordedChecks: 288,
    expectedChecks: 288,
    uptimePercent: 100,
    coveragePercent: 100,
    partialData: false,
    ...overrides,
  };
}

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [1, '1s'],
    [45, '45s'],
    [60, '1m'],
    [90, '1m 30s'],
    [930, '15m 30s'],
    [3600, '1h'],
    [5400, '1h 30m'],
    [90000, '1d 1h'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-09-10T12:00:00.000Z').getTime();

  it('says "never" for a monitor that has never been checked', () => {
    expect(formatRelative(null, now)).toBe('never');
  });

  it('says "just now" inside ten seconds', () => {
    expect(formatRelative('2026-09-10T11:59:57.000Z', now)).toBe('just now');
  });

  it('describes the past in the past tense', () => {
    expect(formatRelative('2026-09-10T11:55:00.000Z', now)).toBe('5m ago');
  });

  it('describes a future timestamp as future, for nextCheckAt', () => {
    expect(formatRelative('2026-09-10T12:04:00.000Z', now)).toBe('in 4m');
  });

  it('does not crash on a malformed timestamp', () => {
    expect(formatRelative('not-a-date', now)).toBe('unknown');
  });
});

describe('formatUptime', () => {
  it('shows a dash rather than 0% or 100% when nothing was recorded', () => {
    // This is the whole point: a monitor with no data must not look perfect,
    // and must not look broken either.
    expect(formatUptime(summary({ uptimePercent: null, recordedChecks: 0 }))).toBe('—');
  });

  it('shows two decimals so a single failure is visible', () => {
    expect(formatUptime(summary({ uptimePercent: 99.65 }))).toBe('99.65%');
    expect(formatUptime(summary({ uptimePercent: 100 }))).toBe('100.00%');
  });
});

describe('formatMs', () => {
  it('shows a dash for a missing measurement', () => {
    expect(formatMs(null)).toBe('—');
  });

  it('rounds to whole milliseconds', () => {
    expect(formatMs(142.6)).toBe('143 ms');
  });
});

describe('hostnameOf', () => {
  it('extracts the hostname for display', () => {
    expect(hostnameOf('https://example.com/deep/path?x=1')).toBe('example.com');
  });

  it('falls back to the raw value rather than throwing', () => {
    expect(hostnameOf('not a url')).toBe('not a url');
  });
});
