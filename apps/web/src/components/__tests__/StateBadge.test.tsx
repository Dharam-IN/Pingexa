import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MonitorDisplayState } from '@pingexa/shared';
import { StateBadge } from '../StateBadge';

describe('StateBadge', () => {
  it.each<[MonitorDisplayState, string]>([
    ['UP', 'Up'],
    ['DOWN', 'Down'],
    ['PENDING', 'Waiting for first check'],
    ['PAUSED', 'Paused'],
    ['STALE', 'Unknown'],
  ])('labels %s as "%s"', (state, label) => {
    render(<StateBadge state={state} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('never relies on colour alone — every state carries a word and an explanation', () => {
    const { container } = render(<StateBadge state="STALE" />);
    const badge = container.querySelector('[title]');
    expect(badge?.textContent).toContain('Unknown');
    expect(badge?.getAttribute('title')).toMatch(/stopped arriving/);
  });
});
