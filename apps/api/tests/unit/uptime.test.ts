import { describe, expect, it } from 'vitest';
import { computeUptime, isMonitoringStale, PARTIAL_DATA_COVERAGE_THRESHOLD } from '../../src/domain/uptime.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const DAY_AGO = new Date('2026-09-09T12:00:00.000Z');
const WEEK_AGO = new Date('2026-09-03T12:00:00.000Z');

describe('uptime', () => {
  it('reports 100% when every recorded check succeeded', () => {
    const summary = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: WEEK_AGO,
      intervalSeconds: 300,
      counts: { upChecks: 288, downChecks: 0 },
    });
    expect(summary.uptimePercent).toBe(100);
    expect(summary.expectedChecks).toBe(288);
    expect(summary.coveragePercent).toBe(100);
    expect(summary.partialData).toBe(false);
  });

  it('computes the percentage only from recorded checks', () => {
    const summary = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: WEEK_AGO,
      intervalSeconds: 300,
      counts: { upChecks: 285, downChecks: 3 },
    });
    expect(summary.uptimePercent).toBe(98.96);
    expect(summary.recordedChecks).toBe(288);
  });

  it('does not count a monitoring gap as uptime or as downtime', () => {
    // Half the window was never checked: uptime stays 100% of what we saw,
    // and coverage tells the caller that half the window is unknown.
    const summary = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: WEEK_AGO,
      intervalSeconds: 300,
      counts: { upChecks: 144, downChecks: 0 },
    });
    expect(summary.uptimePercent).toBe(100);
    expect(summary.downChecks).toBe(0);
    expect(summary.coveragePercent).toBe(50);
    expect(summary.partialData).toBe(true);
  });

  it('returns a null percentage rather than 0 or 100 when nothing was recorded', () => {
    const summary = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: WEEK_AGO,
      intervalSeconds: 300,
      counts: { upChecks: 0, downChecks: 0 },
    });
    expect(summary.uptimePercent).toBeNull();
    expect(summary.coveragePercent).toBe(0);
  });

  it('only expects checks from when the monitor existed', () => {
    const createdAt = new Date(NOW.getTime() - 60 * 60 * 1000);
    const summary = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: createdAt,
      intervalSeconds: 300,
      counts: { upChecks: 12, downChecks: 0 },
    });
    // One hour at five minutes is 12 checks, not 288.
    expect(summary.expectedChecks).toBe(12);
    expect(summary.coveragePercent).toBe(100);
    expect(summary.partialData).toBe(false);
  });

  it('does not report over 100% coverage when extra checks exist', () => {
    const summary = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: WEEK_AGO,
      intervalSeconds: 300,
      counts: { upChecks: 400, downChecks: 0 },
    });
    expect(summary.coveragePercent).toBe(100);
  });

  it('treats a brand new monitor as full coverage rather than zero', () => {
    const summary = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: NOW,
      intervalSeconds: 300,
      counts: { upChecks: 0, downChecks: 0 },
    });
    expect(summary.expectedChecks).toBe(0);
    expect(summary.coveragePercent).toBe(0);
    expect(summary.uptimePercent).toBeNull();
  });

  it('flags partial data exactly at the documented threshold', () => {
    const justUnder = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: WEEK_AGO,
      intervalSeconds: 300,
      counts: { upChecks: 258, downChecks: 0 },
    });
    expect(justUnder.coveragePercent).toBeLessThan(PARTIAL_DATA_COVERAGE_THRESHOLD);
    expect(justUnder.partialData).toBe(true);

    const justOver = computeUptime({
      window: '24h',
      now: NOW,
      monitorCreatedAt: WEEK_AGO,
      intervalSeconds: 300,
      counts: { upChecks: 270, downChecks: 0 },
    });
    expect(justOver.coveragePercent).toBeGreaterThanOrEqual(PARTIAL_DATA_COVERAGE_THRESHOLD);
    expect(justOver.partialData).toBe(false);
  });

  it('uses a 7-day window when asked', () => {
    const summary = computeUptime({
      window: '7d',
      now: NOW,
      monitorCreatedAt: new Date('2026-01-01T00:00:00.000Z'),
      intervalSeconds: 300,
      counts: { upChecks: 2016, downChecks: 0 },
    });
    expect(summary.expectedChecks).toBe(2016);
    expect(summary.windowStart).toBe('2026-09-03T12:00:00.000Z');
    expect(summary.windowEnd).toBe('2026-09-10T12:00:00.000Z');
  });
});

describe('stale monitoring detection', () => {
  const base = {
    paused: false,
    nextCheckAt: NOW,
    createdAt: DAY_AGO,
    intervalSeconds: 300,
    now: NOW,
    staleMultiplier: 3,
  };

  it('is not stale when the last check is recent', () => {
    expect(
      isMonitoringStale({ ...base, lastCheckedAt: new Date(NOW.getTime() - 4 * 60 * 1000) }),
    ).toBe(false);
  });

  it('is stale when checks stopped arriving', () => {
    // A worker outage: the last check is older than three intervals.
    expect(
      isMonitoringStale({ ...base, lastCheckedAt: new Date(NOW.getTime() - 20 * 60 * 1000) }),
    ).toBe(true);
  });

  it('is never stale while paused', () => {
    expect(
      isMonitoringStale({
        ...base,
        paused: true,
        nextCheckAt: null,
        lastCheckedAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
      }),
    ).toBe(false);
  });

  it('is never stale when the monitor is not scheduled at all', () => {
    // An unverified account: monitoring has not started, so "stale" would be a
    // lie. The UI shows the unverified state instead.
    expect(isMonitoringStale({ ...base, nextCheckAt: null, lastCheckedAt: null })).toBe(false);
  });

  it('falls back to creation time for a monitor that has never been checked', () => {
    expect(isMonitoringStale({ ...base, lastCheckedAt: null })).toBe(true);
    expect(
      isMonitoringStale({ ...base, createdAt: new Date(NOW.getTime() - 60 * 1000), lastCheckedAt: null }),
    ).toBe(false);
  });
});
