/** Persisted lifecycle state of a monitor, independent of pause and staleness. */
export const MONITOR_STATES = ['PENDING', 'UP', 'DOWN'] as const;
export type MonitorState = (typeof MONITOR_STATES)[number];

/**
 * What the UI shows. `PAUSED` and `STALE` are derived presentation states, not
 * stored values: a paused monitor keeps its last known `state`, and `STALE` means
 * scheduled checks have stopped arriving so the real state is unknown.
 */
export const MONITOR_DISPLAY_STATES = ['PENDING', 'UP', 'DOWN', 'PAUSED', 'STALE'] as const;
export type MonitorDisplayState = (typeof MONITOR_DISPLAY_STATES)[number];

export const CHECK_OUTCOMES = ['UP', 'DOWN'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** Machine-readable classification of a failed check. */
export const FAILURE_KINDS = [
  'HTTP_ERROR',
  'REDIRECT',
  'TIMEOUT',
  'DNS_ERROR',
  'CONNECTION_ERROR',
  'TLS_ERROR',
  'BLOCKED_ADDRESS',
  'INVALID_URL',
  'RESPONSE_TOO_LARGE',
  'UNKNOWN_ERROR',
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export const INCIDENT_CLOSE_REASONS = [
  'RECOVERED',
  'MONITOR_RECONFIGURED',
  'MONITOR_PAUSED',
] as const;
export type IncidentCloseReason = (typeof INCIDENT_CLOSE_REASONS)[number];

export const NOTIFICATION_KINDS = ['DOWN', 'RECOVERY'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Human copy for failure kinds, safe to show to the monitor's owner. */
export const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  HTTP_ERROR: 'HTTP error status',
  REDIRECT: 'Redirect not followed',
  TIMEOUT: 'Request timed out',
  DNS_ERROR: 'DNS lookup failed',
  CONNECTION_ERROR: 'Connection failed',
  TLS_ERROR: 'TLS handshake failed',
  BLOCKED_ADDRESS: 'Address not publicly routable',
  INVALID_URL: 'URL is no longer monitorable',
  RESPONSE_TOO_LARGE: 'Response exceeded size limit',
  UNKNOWN_ERROR: 'Check failed',
};
