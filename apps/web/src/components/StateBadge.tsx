import type { MonitorDisplayState } from '@pingexa/shared';
import { STATE_HELP, STATE_LABEL } from '../lib/format';
import { Badge, type Tone } from './ui';

/**
 * The one place a monitor state becomes a colour and a word.
 *
 * Every state carries a title explaining what it means, because "Unknown" and
 * "Waiting for first check" are meaningless without it. Colour is never the only
 * signal: the label is always present, and the dot is decoration on top of it.
 */
export const STATE_TONE: Record<MonitorDisplayState, Tone> = {
  UP: 'up',
  DOWN: 'down',
  PENDING: 'info',
  PAUSED: 'neutral',
  STALE: 'warn',
};

export function StateBadge({
  state,
  size = 'md',
}: {
  state: MonitorDisplayState;
  size?: 'sm' | 'md';
}) {
  return (
    <Badge tone={STATE_TONE[state]} size={size} dot title={STATE_HELP[state]}>
      {STATE_LABEL[state]}
    </Badge>
  );
}
