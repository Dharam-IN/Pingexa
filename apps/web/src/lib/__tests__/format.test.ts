import { describe, expect, it } from 'vitest';
import type { UptimeSummary } from '@pingexa/shared';
import {
  coverageNote,
  displayUrl,
  explainState,
  failureProgress,
  formatDuration,
  formatMs,
  formatNextCheck,
  formatRelative,
  formatUptime,
  hostnameOf,
  normaliseMonitorUrl,
  plural,
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

describe('plural', () => {
  it('uses the singular for exactly one', () => {
    expect(plural(1, 'check')).toBe('1 check');
    expect(plural(0, 'check')).toBe('0 checks');
    expect(plural(2, 'check')).toBe('2 checks');
  });

  it('accepts an irregular plural', () => {
    expect(plural(2, 'is', 'are')).toBe('2 are');
  });
});

describe('displayUrl', () => {
  it('drops https:// but keeps http://, because the insecure one is the news', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com');
    expect(displayUrl('http://example.com/')).toBe('http://example.com');
  });

  it('keeps the path, so two monitors on one host stay distinguishable', () => {
    expect(displayUrl('https://example.com/health')).toBe('example.com/health');
    expect(displayUrl('https://example.com/a?b=c')).toBe('example.com/a?b=c');
  });

  it('truncates rather than overflowing, without losing the host', () => {
    const long = `https://example.com/${'segment/'.repeat(20)}`;
    const shortened = displayUrl(long, 30);
    expect(shortened).toHaveLength(30);
    expect(shortened.startsWith('example.com/')).toBe(true);
    expect(shortened.endsWith('…')).toBe(true);
  });

  it('returns unparseable input unchanged rather than inventing a shape', () => {
    expect(displayUrl('not a url')).toBe('not a url');
  });
});

describe('normaliseMonitorUrl', () => {
  it('adds the scheme people leave off', () => {
    expect(normaliseMonitorUrl('example.com')).toBe('https://example.com');
    expect(normaliseMonitorUrl('  example.com/health  ')).toBe('https://example.com/health');
  });

  it('keeps an explicit scheme, including http', () => {
    expect(normaliseMonitorUrl('http://example.com')).toBe('http://example.com');
    expect(normaliseMonitorUrl('https://example.com/a')).toBe('https://example.com/a');
  });

  it('lowercases the host and drops a default port', () => {
    expect(normaliseMonitorUrl('HTTPS://Example.COM:443/Path')).toBe('https://example.com/Path');
    expect(normaliseMonitorUrl('http://example.com:80/')).toBe('http://example.com');
  });

  it('keeps a non-default port rather than silently removing it', () => {
    // Whether 8080 is allowed is the server's decision, not this helper's. It
    // must not quietly rewrite the URL into one that would be accepted.
    expect(normaliseMonitorUrl('https://example.com:8080/')).toBe('https://example.com:8080');
  });

  it('returns null for anything it cannot repair, leaving the server to judge', () => {
    expect(normaliseMonitorUrl('')).toBeNull();
    expect(normaliseMonitorUrl('   ')).toBeNull();
    expect(normaliseMonitorUrl('not a url at all')).toBeNull();
    expect(normaliseMonitorUrl('ftp://example.com')).toBeNull();
    expect(normaliseMonitorUrl('javascript:alert(1)')).toBeNull();
  });

  it('never claims an address is safe to monitor', () => {
    // It is cosmetic only. A private address normalises fine here and is
    // rejected by the server's guard, which is the only authority.
    expect(normaliseMonitorUrl('http://169.254.169.254/')).toBe('http://169.254.169.254');
  });
});

describe('formatNextCheck', () => {
  const now = Date.parse('2026-09-10T12:00:00.000Z');

  it('names the subject so it cannot be read as an elapsed time', () => {
    expect(
      formatNextCheck({ paused: false, nextCheckAt: '2026-09-10T12:02:30.000Z' }, now),
    ).toBe('Next check in 2m 30s');
  });

  it('says a due check is due', () => {
    expect(formatNextCheck({ paused: false, nextCheckAt: '2026-09-10T11:59:00.000Z' }, now)).toBe(
      'Next check due now',
    );
  });

  it('never guesses a schedule for a paused or unscheduled monitor', () => {
    expect(formatNextCheck({ paused: true, nextCheckAt: null }, now)).toBe(
      'Paused — no checks scheduled',
    );
    // Paused wins even if a stale nextCheckAt is still on the row.
    expect(
      formatNextCheck({ paused: true, nextCheckAt: '2026-09-10T12:05:00.000Z' }, now),
    ).toBe('Paused — no checks scheduled');
    expect(formatNextCheck({ paused: false, nextCheckAt: null }, now)).toBe('No check scheduled');
    expect(formatNextCheck({ paused: false, nextCheckAt: 'nonsense' }, now)).toBe(
      'No check scheduled',
    );
  });
});

describe('failureProgress', () => {
  it('says nothing when there is nothing to report', () => {
    expect(failureProgress({ displayState: 'UP', consecutiveFailures: 0 }, 3)).toBeNull();
  });

  it('says nothing once the monitor is already down', () => {
    // At that point the down alert carries the message; repeating the countdown
    // for an outage that already happened is noise.
    expect(failureProgress({ displayState: 'DOWN', consecutiveFailures: 5 }, 3)).toBeNull();
  });

  it('counts down to the threshold in whole failures', () => {
    expect(failureProgress({ displayState: 'UP', consecutiveFailures: 1 }, 3)).toBe(
      '1 failed check in a row. 2 more failures declare this monitor down.',
    );
    expect(failureProgress({ displayState: 'UP', consecutiveFailures: 2 }, 3)).toBe(
      '2 failed checks in a row. One more failure declares this monitor down.',
    );
  });
});

describe('coverageNote', () => {
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

  it('says nothing when coverage is complete', () => {
    expect(coverageNote(summary())).toBeNull();
  });

  it('quantifies the gap and states how it is counted', () => {
    const note = coverageNote(
      summary({ recordedChecks: 144, upChecks: 144, coveragePercent: 50, partialData: true }),
    );
    expect(note).toContain('50% coverage');
    expect(note).toContain('144 expected checks');
    expect(note).toContain('neither up nor down');
  });

  it('distinguishes "no data at all" from "a partial window"', () => {
    const note = coverageNote(
      summary({
        upChecks: 0,
        recordedChecks: 0,
        uptimePercent: null,
        coveragePercent: 0,
        partialData: true,
      }),
    );
    expect(note).toBe('No checks were recorded in this window.');
  });
});

describe('explainState', () => {
  const base = { state: 'UP' as const, consecutiveFailures: 0, lastFailureReason: null, failureThreshold: 3 };

  it('describes a healthy monitor plainly', () => {
    expect(explainState({ ...base, displayState: 'UP' })).toBe(
      'The last scheduled check succeeded.',
    );
  });

  it('mentions a recovered blip without calling the monitor unhealthy', () => {
    expect(explainState({ ...base, displayState: 'UP', consecutiveFailures: 2 })).toContain(
      '2 recent checks failed first',
    );
  });

  it('names the rule that produced a down state', () => {
    expect(
      explainState({ ...base, displayState: 'DOWN', state: 'DOWN', consecutiveFailures: 3 }),
    ).toBe('Confirmed down after 3 consecutive failed checks.');
    expect(
      explainState({ ...base, displayState: 'DOWN', state: 'DOWN', consecutiveFailures: 7 }),
    ).toContain('7 have now failed in a row');
  });

  it('says a paused or stale monitor has an unknown state, not a bad one', () => {
    expect(explainState({ ...base, displayState: 'PAUSED' })).toContain('not being tracked');
    expect(explainState({ ...base, displayState: 'STALE' })).toContain('state is unknown');
  });

  it('tells a pending monitor that waiting is normal', () => {
    expect(explainState({ ...base, displayState: 'PENDING', state: 'PENDING' })).toContain(
      'no check has completed yet',
    );
  });
});
