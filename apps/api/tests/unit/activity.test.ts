import { describe, expect, it } from 'vitest';
import type { Check } from '../../src/generated/prisma/client.js';
import { bucketChecks, summariseActivity } from '../../src/domain/activity.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');

type CheckRow = Pick<Check, 'monitorId' | 'checkedAt' | 'outcome' | 'responseTimeMs'>;

function check(overrides: Partial<CheckRow> = {}): CheckRow {
  return {
    monitorId: 'monitor-1',
    checkedAt: NOW,
    outcome: 'UP',
    responseTimeMs: 100,
    ...overrides,
  };
}

/** Minutes before `NOW`, as a Date. */
function ago(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

describe('bucketChecks', () => {
  it('divides 24 hours into 48 half-hour buckets covering the whole window', () => {
    const timeline = bucketChecks({ monitorId: 'm', window: '24h', now: NOW, checks: [] });

    expect(timeline.buckets).toHaveLength(48);
    expect(timeline.bucketSeconds).toBe(1800);
    expect(timeline.buckets[0]?.startedAt).toBe(ago(24 * 60).toISOString());
    expect(timeline.buckets[47]?.endedAt).toBe(NOW.toISOString());
  });

  it('reports a bucket with no checks as a gap, never as a zero', () => {
    // This is the rule the whole product rests on: a check that did not run is
    // not uptime and not downtime. A bucket that fabricated `0 ms` here would
    // draw as an instantaneous response, which is the opposite of the truth.
    const timeline = bucketChecks({ monitorId: 'm', window: '24h', now: NOW, checks: [] });

    for (const bucket of timeline.buckets) {
      expect(bucket.recordedChecks).toBe(0);
      expect(bucket.upChecks).toBe(0);
      expect(bucket.downChecks).toBe(0);
      expect(bucket.avgResponseTimeMs).toBeNull();
    }
  });

  it('counts each check into the bucket its timestamp falls in', () => {
    const timeline = bucketChecks({
      monitorId: 'm',
      window: '24h',
      now: NOW,
      checks: [
        // Newest half hour.
        check({ checkedAt: ago(10) }),
        check({ checkedAt: ago(20), outcome: 'DOWN', responseTimeMs: null }),
        // Oldest half hour.
        check({ checkedAt: ago(24 * 60 - 5) }),
      ],
    });

    const last = timeline.buckets[47];
    expect(last?.upChecks).toBe(1);
    expect(last?.downChecks).toBe(1);
    expect(last?.recordedChecks).toBe(2);

    expect(timeline.buckets[0]?.recordedChecks).toBe(1);
    // Everything between the two stayed empty.
    const middle = timeline.buckets.slice(1, 47);
    expect(middle.every((bucket) => bucket.recordedChecks === 0)).toBe(true);
  });

  it('averages response time over successful checks only', () => {
    const timeline = bucketChecks({
      monitorId: 'm',
      window: '24h',
      now: NOW,
      checks: [
        check({ checkedAt: ago(5), responseTimeMs: 100 }),
        check({ checkedAt: ago(6), responseTimeMs: 200 }),
        // A failure has no response time and must not drag the average to zero.
        check({ checkedAt: ago(7), outcome: 'DOWN', responseTimeMs: null }),
      ],
    });

    expect(timeline.buckets[47]?.avgResponseTimeMs).toBe(150);
  });

  it('ignores checks outside the window rather than clamping them into an edge bucket', () => {
    const timeline = bucketChecks({
      monitorId: 'm',
      window: '24h',
      now: NOW,
      checks: [
        check({ checkedAt: ago(24 * 60 + 60) }),
        check({ checkedAt: new Date(NOW.getTime() + 60_000) }),
      ],
    });

    expect(timeline.buckets.every((bucket) => bucket.recordedChecks === 0)).toBe(true);
  });

  it('puts a check landing exactly on the window end inside the last bucket', () => {
    const timeline = bucketChecks({
      monitorId: 'm',
      window: '24h',
      now: NOW,
      checks: [check({ checkedAt: NOW })],
    });

    expect(timeline.buckets[47]?.recordedChecks).toBe(1);
  });

  it('uses a coarser grid for the 7-day window', () => {
    const timeline = bucketChecks({ monitorId: 'm', window: '7d', now: NOW, checks: [] });
    expect(timeline.buckets).toHaveLength(56);
    expect(timeline.bucketSeconds).toBe(10_800);
  });
});

describe('summariseActivity', () => {
  it('counts outcomes and the monitors that reported', () => {
    const summary = summariseActivity({
      window: '24h',
      now: NOW,
      checks: [
        check({ monitorId: 'a' }),
        check({ monitorId: 'a', outcome: 'DOWN', responseTimeMs: null }),
        check({ monitorId: 'b' }),
      ],
      incidentsStarted: 1,
    });

    expect(summary.recordedChecks).toBe(3);
    expect(summary.upChecks).toBe(2);
    expect(summary.downChecks).toBe(1);
    expect(summary.monitorsWithData).toBe(2);
    expect(summary.incidentsStarted).toBe(1);
    expect(summary.windowStart).toBe(ago(24 * 60).toISOString());
    expect(summary.windowEnd).toBe(NOW.toISOString());
  });

  it('reports a null median when nothing succeeded, not a zero', () => {
    const summary = summariseActivity({
      window: '24h',
      now: NOW,
      checks: [check({ outcome: 'DOWN', responseTimeMs: null })],
      incidentsStarted: 0,
    });

    expect(summary.medianResponseTimeMs).toBeNull();
    expect(summary.downChecks).toBe(1);
  });

  it('reports a null median for an account with no checks at all', () => {
    const summary = summariseActivity({
      window: '24h',
      now: NOW,
      checks: [],
      incidentsStarted: 0,
    });

    expect(summary.medianResponseTimeMs).toBeNull();
    expect(summary.recordedChecks).toBe(0);
    expect(summary.monitorsWithData).toBe(0);
  });

  it('takes the median rather than the mean, so one timeout cannot distort it', () => {
    // The point of choosing the median: a single 10-second timeout among fast
    // responses would drag a mean to ~2s and make a healthy account look slow.
    const summary = summariseActivity({
      window: '24h',
      now: NOW,
      checks: [
        check({ responseTimeMs: 100 }),
        check({ responseTimeMs: 110 }),
        check({ responseTimeMs: 120 }),
        check({ responseTimeMs: 130 }),
        check({ responseTimeMs: 10_000 }),
      ],
      incidentsStarted: 0,
    });

    expect(summary.medianResponseTimeMs).toBe(120);
  });

  it('averages the two middle values for an even number of samples', () => {
    const summary = summariseActivity({
      window: '24h',
      now: NOW,
      checks: [
        check({ responseTimeMs: 100 }),
        check({ responseTimeMs: 200 }),
        check({ responseTimeMs: 300 }),
        check({ responseTimeMs: 500 }),
      ],
      incidentsStarted: 0,
    });

    expect(summary.medianResponseTimeMs).toBe(250);
  });

  it('excludes failed checks from the median even when they carry a time', () => {
    const summary = summariseActivity({
      window: '24h',
      now: NOW,
      checks: [
        check({ responseTimeMs: 100 }),
        // A failure should never contribute to "typical response time", whatever
        // is stored against it.
        check({ outcome: 'DOWN', responseTimeMs: 9_000 }),
      ],
      incidentsStarted: 0,
    });

    expect(summary.medianResponseTimeMs).toBe(100);
  });
});
