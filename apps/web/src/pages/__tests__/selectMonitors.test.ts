import { describe, expect, it } from 'vitest';
import type { MonitorDisplayState, MonitorSummary, UptimeSummary } from '@pingexa/shared';
import { selectMonitors } from '../MonitorsPage';

function uptime(percent: number | null): UptimeSummary {
  return {
    window: '24h',
    windowStart: '2026-09-09T12:00:00.000Z',
    windowEnd: '2026-09-10T12:00:00.000Z',
    upChecks: percent === null ? 0 : 100,
    downChecks: 0,
    recordedChecks: percent === null ? 0 : 100,
    expectedChecks: 288,
    uptimePercent: percent,
    coveragePercent: percent === null ? 0 : 100,
    partialData: percent === null,
  };
}

function monitor(overrides: Partial<MonitorSummary> = {}): MonitorSummary {
  return {
    id: overrides.name ?? 'id',
    name: 'Monitor',
    url: 'https://example.com/',
    state: 'UP',
    displayState: 'UP',
    paused: false,
    isPublic: false,
    intervalSeconds: 300,
    consecutiveFailures: 0,
    monitoringStale: false,
    lastCheckedAt: '2026-09-10T11:55:00.000Z',
    lastResponseTimeMs: 100,
    lastStatusCode: 200,
    lastFailureKind: null,
    lastFailureReason: null,
    nextCheckAt: '2026-09-10T12:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-10T11:55:00.000Z',
    uptime24h: uptime(100),
    openIncidentId: null,
    ...overrides,
  };
}

function named(name: string, displayState: MonitorDisplayState, extra: Partial<MonitorSummary> = {}) {
  return monitor({ id: name, name, displayState, ...extra });
}

const ALL = [
  named('Healthy', 'UP'),
  named('Broken', 'DOWN'),
  named('Sleeping', 'PAUSED'),
  named('Quiet', 'STALE'),
  named('New', 'PENDING'),
];

const base = { query: '', filter: 'all', sort: 'attention' } as const;

describe('selectMonitors — ordering', () => {
  it('puts problems first by default', () => {
    // The page tells the reader "problems first". That is a promise about
    // ordering, and it is exactly the kind that rots without a test.
    const result = selectMonitors({ ...base, monitors: ALL });
    expect(result.map((entry) => entry.displayState)).toEqual([
      'DOWN',
      'STALE',
      'PENDING',
      'UP',
      'PAUSED',
    ]);
  });

  it('ranks the worse failure streak first within the same state', () => {
    const result = selectMonitors({
      ...base,
      monitors: [
        named('One failure', 'UP', { consecutiveFailures: 1 }),
        named('Two failures', 'UP', { consecutiveFailures: 2 }),
        named('Healthy', 'UP'),
      ],
    });
    expect(result.map((entry) => entry.name)).toEqual(['Two failures', 'One failure', 'Healthy']);
  });

  it('sorts by name when asked', () => {
    const result = selectMonitors({ ...base, monitors: ALL, sort: 'name' });
    expect(result.map((entry) => entry.name)).toEqual([
      'Broken',
      'Healthy',
      'New',
      'Quiet',
      'Sleeping',
    ]);
  });

  it('sorts worst uptime first, and puts "no data" last rather than treating it as 0%', () => {
    // A monitor with no recorded checks has unknown uptime, not bad uptime.
    // Sorting it to the top of a worst-first list would assert something false.
    const result = selectMonitors({
      ...base,
      sort: 'uptime',
      monitors: [
        named('Perfect', 'UP', { uptime24h: uptime(100) }),
        named('No data', 'PENDING', { uptime24h: uptime(null) }),
        named('Poor', 'UP', { uptime24h: uptime(80) }),
      ],
    });
    expect(result.map((entry) => entry.name)).toEqual(['Poor', 'Perfect', 'No data']);
  });

  it('sorts slowest response first and puts a missing measurement last', () => {
    const result = selectMonitors({
      ...base,
      sort: 'response',
      monitors: [
        named('Fast', 'UP', { lastResponseTimeMs: 50 }),
        named('Unmeasured', 'DOWN', { lastResponseTimeMs: null }),
        named('Slow', 'UP', { lastResponseTimeMs: 900 }),
      ],
    });
    expect(result.map((entry) => entry.name)).toEqual(['Slow', 'Fast', 'Unmeasured']);
  });
});

describe('selectMonitors — filtering', () => {
  it('matches on the monitor name, case-insensitively', () => {
    const result = selectMonitors({ ...base, monitors: ALL, query: 'BROK' });
    expect(result.map((entry) => entry.name)).toEqual(['Broken']);
  });

  it('matches on the host as well as the name', () => {
    const monitors = [
      named('Marketing', 'UP', { url: 'https://shop.example.org/' }),
      named('Docs', 'UP', { url: 'https://docs.example.net/' }),
    ];
    expect(
      selectMonitors({ ...base, monitors, query: 'shop.example.org' }).map((m) => m.name),
    ).toEqual(['Marketing']);
  });

  it('matches on a path inside the URL', () => {
    const monitors = [
      named('Health', 'UP', { url: 'https://api.example.com/health' }),
      named('Root', 'UP', { url: 'https://api.example.com/' }),
    ];
    expect(selectMonitors({ ...base, monitors, query: '/health' }).map((m) => m.name)).toEqual([
      'Health',
    ]);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(selectMonitors({ ...base, monitors: ALL, query: '   ' })).toHaveLength(ALL.length);
    expect(selectMonitors({ ...base, monitors: ALL, query: '  broken  ' })).toHaveLength(1);
  });

  it('filters to a single state', () => {
    expect(selectMonitors({ ...base, monitors: ALL, filter: 'down' }).map((m) => m.name)).toEqual([
      'Broken',
    ]);
    expect(selectMonitors({ ...base, monitors: ALL, filter: 'paused' }).map((m) => m.name)).toEqual([
      'Sleeping',
    ]);
  });

  it('groups pending and stale under one filter, because both mean "not reporting"', () => {
    const result = selectMonitors({ ...base, monitors: ALL, filter: 'pending' });
    expect(result.map((entry) => entry.displayState).sort()).toEqual(['PENDING', 'STALE']);
  });

  it('applies the filter and the query together', () => {
    const monitors = [named('Alpha', 'DOWN'), named('Beta', 'DOWN'), named('Alpha two', 'UP')];
    const result = selectMonitors({ ...base, monitors, filter: 'down', query: 'alpha' });
    expect(result.map((entry) => entry.name)).toEqual(['Alpha']);
  });

  it('returns an empty list rather than throwing when nothing matches', () => {
    expect(selectMonitors({ ...base, monitors: ALL, query: 'nothing-matches-this' })).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const monitors = [named('B', 'UP'), named('A', 'DOWN')];
    const snapshot = monitors.map((entry) => entry.name);
    selectMonitors({ ...base, monitors, sort: 'name' });
    expect(monitors.map((entry) => entry.name)).toEqual(snapshot);
  });
});
