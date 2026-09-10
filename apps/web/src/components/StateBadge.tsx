import clsx from 'clsx';
import type { MonitorDisplayState } from '@pingexa/shared';
import { STATE_HELP, STATE_LABEL } from '../lib/format';

/**
 * The one place a monitor state becomes a colour and a word.
 *
 * Every state carries a title explaining what it means, because "Unknown" and
 * "Waiting for first check" are meaningless without it. Colour is never the only
 * signal: the label is always present.
 */
const TONES: Record<MonitorDisplayState, string> = {
  UP: 'bg-up-50 text-up-700 border-up-500/40 dark:bg-up-700/25 dark:text-up-50 dark:border-up-600',
  DOWN: 'bg-down-50 text-down-700 border-down-500/40 dark:bg-down-700/25 dark:text-down-50 dark:border-down-600',
  PENDING:
    'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-900/35 dark:text-brand-100 dark:border-brand-700',
  PAUSED:
    'bg-[var(--surface-sunken)] text-muted border-[var(--border-subtle)]',
  STALE:
    'bg-warn-50 text-warn-700 border-warn-500/40 dark:bg-warn-700/25 dark:text-warn-50 dark:border-warn-600',
};

const DOT: Record<MonitorDisplayState, string> = {
  UP: 'bg-up-500',
  DOWN: 'bg-down-500',
  PENDING: 'bg-brand-400',
  PAUSED: 'bg-[var(--text-muted)]',
  STALE: 'bg-warn-500',
};

export function StateBadge({
  state,
  size = 'md',
}: {
  state: MonitorDisplayState;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      title={STATE_HELP[state]}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
        TONES[state],
      )}
    >
      <span className={clsx('size-2 rounded-full', DOT[state])} aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}
