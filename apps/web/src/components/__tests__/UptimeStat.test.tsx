import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { UptimeSummary } from '@pingexa/shared';
import { UptimeStat } from '../UptimeStat';

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

describe('UptimeStat', () => {
  it('shows the percentage and how it was derived', () => {
    render(<UptimeStat summary={summary({ upChecks: 285, downChecks: 3, uptimePercent: 98.96 })} label="Uptime · 24 hours" />);
    expect(screen.getByText('98.96%')).toBeInTheDocument();
    expect(screen.getByText('285 of 288 recorded checks succeeded.')).toBeInTheDocument();
  });

  it('never displays a percentage when nothing was recorded', () => {
    render(
      <UptimeStat
        summary={summary({
          upChecks: 0,
          downChecks: 0,
          recordedChecks: 0,
          uptimePercent: null,
          coveragePercent: 0,
          partialData: true,
        })}
        label="Uptime · 24 hours"
      />,
    );
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No checks recorded in this window yet.')).toBeInTheDocument();
  });

  it('warns about a coverage gap and says how it is counted', () => {
    // The requirement this covers: a missing check must not read as uptime or
    // as downtime, and the reader has to be told.
    render(
      <UptimeStat
        summary={summary({
          upChecks: 144,
          downChecks: 0,
          recordedChecks: 144,
          expectedChecks: 288,
          coveragePercent: 50,
          partialData: true,
        })}
        label="Uptime · 24 hours"
      />,
    );
    // The wording comes from `coverageNote`, which every uptime figure in the
    // app shares; assert the three facts it must carry, not its exact prose.
    const warning = screen.getByText(/coverage/);
    expect(warning.textContent).toContain('50% coverage');
    expect(warning.textContent).toContain('144 expected checks');
    expect(warning.textContent).toContain('neither up nor down');
  });

  it('says nothing about coverage when it is complete', () => {
    render(<UptimeStat summary={summary()} label="Uptime · 24 hours" />);
    expect(screen.queryByText(/coverage/)).not.toBeInTheDocument();
  });
});
