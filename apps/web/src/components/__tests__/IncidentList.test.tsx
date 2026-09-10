import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { IncidentRecord } from '@pingexa/shared';
import { IncidentList } from '../IncidentList';

function incident(overrides: Partial<IncidentRecord> = {}): IncidentRecord {
  return {
    id: 'i1',
    startedAt: '2026-09-10T10:00:00.000Z',
    detectedAt: '2026-09-10T10:10:00.000Z',
    resolvedAt: '2026-09-10T10:25:00.000Z',
    durationSeconds: 1500,
    ongoing: false,
    closeReason: 'RECOVERED',
    causeKind: 'HTTP_ERROR',
    causeReason: 'Responded with HTTP 503',
    ...overrides,
  };
}

describe('IncidentList', () => {
  it('explains what an empty history means', () => {
    render(<IncidentList incidents={[]} />);
    expect(
      screen.getByText('No incidents recorded. An incident opens after three consecutive failed checks.'),
    ).toBeInTheDocument();
  });

  it('labels each of the three timestamps with its meaning', () => {
    // These three are routinely confused, so the labels are part of the contract.
    render(<IncidentList incidents={[incident()]} />);
    expect(screen.getByText('Started (first failed check)')).toBeInTheDocument();
    expect(screen.getByText('Confirmed (3rd failure, alert sent)')).toBeInTheDocument();
    expect(screen.getByText('Resolved (first success)')).toBeInTheDocument();
    expect(screen.getByText('Down for 25m')).toBeInTheDocument();
  });

  it('marks an ongoing outage as ongoing rather than showing a false end', () => {
    render(<IncidentList incidents={[incident({ resolvedAt: null, ongoing: true, closeReason: null, durationSeconds: 600 })]} />);
    expect(screen.getByText('Ongoing outage')).toBeInTheDocument();
    expect(screen.getByText('not yet')).toBeInTheDocument();
  });

  it('says when an incident closed for a reason other than recovery', () => {
    render(<IncidentList incidents={[incident({ closeReason: 'MONITOR_PAUSED' })]} />);
    expect(
      screen.getByText('Closed because the monitor was paused, not because it recovered.'),
    ).toBeInTheDocument();
  });

  it('shows the cause when one was recorded', () => {
    render(<IncidentList incidents={[incident()]} />);
    expect(screen.getByText('Cause:').parentElement?.textContent).toContain(
      'Responded with HTTP 503',
    );
  });
});
