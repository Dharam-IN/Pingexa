import type { MonitorDisplayState, UptimeSummary } from '@pingexa/shared';

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 1) return '0s';
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  const deltaSeconds = Math.round((now - then) / 1000);
  if (Number.isNaN(deltaSeconds)) return 'unknown';
  if (deltaSeconds < 0) return `in ${formatDuration(-deltaSeconds)}`;
  if (deltaSeconds < 10) return 'just now';
  return `${formatDuration(deltaSeconds)} ago`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Uptime is shown as "—" rather than 0% or 100% when nothing was recorded. */
export function formatUptime(summary: UptimeSummary): string {
  if (summary.uptimePercent === null) return '—';
  return `${summary.uptimePercent.toFixed(2)}%`;
}

export function formatMs(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value)} ms`;
}

export const STATE_LABEL: Record<MonitorDisplayState, string> = {
  PENDING: 'Waiting for first check',
  UP: 'Up',
  DOWN: 'Down',
  PAUSED: 'Paused',
  STALE: 'Unknown',
};

/** One-line explanation of what each state actually means. */
export const STATE_HELP: Record<MonitorDisplayState, string> = {
  PENDING: 'Added, but Pingexa has not completed a check yet.',
  UP: 'The last scheduled check succeeded.',
  DOWN: 'Three consecutive scheduled checks failed.',
  PAUSED: 'Checks are switched off, so the current state is not being tracked.',
  STALE: 'Scheduled checks have stopped arriving, so the real state is unknown.',
};

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
