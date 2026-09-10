/** Product-wide constants shared by the API, the worker and the web client. */

/** Hard cap on monitors per user. Enforced in the database (unique slot 0..2). */
export const MAX_MONITORS_PER_USER = 3;

/** Product check interval. The API exposes this so the UI never guesses. */
export const DEFAULT_MONITOR_INTERVAL_SECONDS = 300;

/** Consecutive failed scheduled checks required before a monitor is declared DOWN. */
export const FAILURE_THRESHOLD = 3;

/** Days of individual check history retained. */
export const CHECK_RETENTION_DAYS = 7;

/** Ports Pingexa is willing to monitor. */
export const ALLOWED_MONITOR_PORTS = [80, 443] as const;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_MONITOR_NAME_LENGTH = 60;
export const MAX_MONITOR_URL_LENGTH = 2000;
export const MAX_STATUS_PAGE_TITLE_LENGTH = 60;

export const UPTIME_WINDOWS = ['24h', '7d'] as const;
export type UptimeWindow = (typeof UPTIME_WINDOWS)[number];

/**
 * A monitor whose newest check is older than this multiple of the interval is
 * reported as `monitoringStale` — we do not know its real state.
 */
export const STALE_INTERVAL_MULTIPLIER = 3;
