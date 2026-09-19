import type { MonitorDisplayState, MonitorState, UptimeSummary } from '@pingexa/shared';

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

/** "1 check" / "2 checks", so call sites stop re-deriving the plural. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * A monitor's URL, shortened for a list without becoming ambiguous.
 *
 * The host is what identifies a monitor at a glance, but two monitors on the
 * same host differ only by path, so the path is kept and truncated rather than
 * dropped. `https://` is stripped because it is on almost every row and carries
 * no information; `http://` is kept precisely because it is unusual.
 */
export function displayUrl(url: string, maxLength = 48): string {
  let shortened = url;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const prefix = parsed.protocol === 'http:' ? 'http://' : '';
    shortened = `${prefix}${parsed.host}${path}${parsed.search}`;
  } catch {
    // Not parseable: show it as given rather than inventing a shape for it.
  }
  if (shortened.length <= maxLength) return shortened;
  return `${shortened.slice(0, maxLength - 1)}…`;
}

/**
 * When the next check is due, in words.
 *
 * Only ever derived from `nextCheckAt`, which the scheduler owns. A paused or
 * unscheduled monitor has no next check, and saying "in 5 minutes" for one
 * would be a guess dressed up as a fact.
 */
export function formatNextCheck(
  monitor: { paused: boolean; nextCheckAt: string | null },
  now = Date.now(),
): string {
  if (monitor.paused) return 'Paused — no checks scheduled';
  if (!monitor.nextCheckAt) return 'No check scheduled';
  const due = new Date(monitor.nextCheckAt).getTime();
  if (Number.isNaN(due)) return 'No check scheduled';
  // The subject is stated every time. A bare "In 2m 40s" beside a "last check"
  // column reads as a second elapsed time rather than as the next one.
  if (due <= now) return 'Next check due now';
  return `Next check in ${formatDuration((due - now) / 1000)}`;
}

/**
 * The plain-language sentence for a monitor's current state.
 *
 * `STATE_HELP` says what the state means in general; this says what is true of
 * *this* monitor right now, including the part of the three-failure rule the
 * reader is currently in the middle of.
 */
export function explainState(monitor: {
  displayState: MonitorDisplayState;
  state: MonitorState;
  consecutiveFailures: number;
  lastFailureReason: string | null;
  failureThreshold: number;
}): string {
  switch (monitor.displayState) {
    case 'UP':
      return monitor.consecutiveFailures > 0
        ? `The last check succeeded, but ${plural(monitor.consecutiveFailures, 'recent check')} failed first.`
        : 'The last scheduled check succeeded.';
    case 'DOWN':
      return `Confirmed down after ${monitor.failureThreshold} consecutive failed checks${
        monitor.consecutiveFailures > monitor.failureThreshold
          ? `; ${monitor.consecutiveFailures} have now failed in a row`
          : ''
      }.`;
    case 'PENDING':
      return 'Added, but no check has completed yet. The first result usually arrives within one interval.';
    case 'PAUSED':
      return `Checks are switched off, so the current state is not being tracked. The last known state was ${monitor.state.toLowerCase()}.`;
    case 'STALE':
      return `Scheduled checks have stopped arriving, so the real state is unknown. The last known state was ${monitor.state.toLowerCase()}.`;
  }
}

/**
 * How far through the failure streak a monitor is, when that is worth saying.
 *
 * Returns `null` when there is nothing to report, so a caller renders nothing
 * rather than an empty box.
 */
export function failureProgress(
  monitor: { displayState: MonitorDisplayState; consecutiveFailures: number },
  threshold: number,
): string | null {
  if (monitor.displayState === 'DOWN') return null;
  if (monitor.consecutiveFailures <= 0) return null;
  const remaining = Math.max(0, threshold - monitor.consecutiveFailures);
  return `${plural(monitor.consecutiveFailures, 'failed check')} in a row. ${
    remaining === 1
      ? 'One more failure declares this monitor down.'
      : `${remaining} more failures declare this monitor down.`
  }`;
}

/** Coverage sentence, or `null` when coverage is not worth qualifying. */
export function coverageNote(summary: UptimeSummary): string | null {
  if (!summary.partialData) return null;
  const missing = Math.max(0, summary.expectedChecks - summary.recordedChecks);
  if (summary.recordedChecks === 0) return 'No checks were recorded in this window.';
  return `${summary.coveragePercent.toFixed(0)}% coverage — ${plural(
    missing,
    'expected check',
  )} missing, counted as neither up nor down.`;
}

/**
 * Tidies a typed URL for display and for submission.
 *
 * Strictly cosmetic, and strictly conservative: it trims whitespace, adds the
 * `https://` a person almost always omits, lowercases the host, and drops a
 * default port and a trailing empty path. It returns `null` when the result is
 * not parseable, in which case the caller submits what was typed and lets the
 * server say why it is wrong.
 *
 * This is **not** validation. It cannot reject anything, and nothing here
 * decides whether an address may be monitored — that is the server's SSRF guard
 * and nothing else (`docs/DECISIONS.md` D9). Keep it that way: a helper in this
 * file that started returning "unsafe" would read like an authority it is not.
 */
export function normaliseMonitorUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // `URL` already lowercases the host and drops a default port; the only
    // cosmetic step left is the bare trailing slash.
    const path = parsed.pathname === '/' && parsed.search === '' && parsed.hash === '' ? '' : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
