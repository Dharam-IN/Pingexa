import type {
  CheckOutcome,
  FailureKind,
  IncidentCloseReason,
  MonitorDisplayState,
  MonitorState,
  NotificationKind,
  NotificationStatus,
} from './enums.js';
import type { UptimeWindow } from './constants.js';

/** Every non-2xx API response has this shape. */
export interface ApiErrorBody {
  error: {
    /** Stable machine-readable code, e.g. `validation_failed`, `monitor_limit_reached`. */
    code: string;
    /** Message safe to display to the caller. */
    message: string;
    /** Field-level validation messages, keyed by dotted field path. */
    fields?: Record<string, string>;
  };
}

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface MeResponse {
  user: SessionUser;
}

/**
 * Uptime over a window. `uptimePercent` is computed only from checks that were
 * actually recorded; `coveragePercent` says how much of the window those checks
 * cover, so a monitoring gap is never silently read as uptime or downtime.
 */
export interface UptimeSummary {
  window: UptimeWindow;
  windowStart: string;
  windowEnd: string;
  upChecks: number;
  downChecks: number;
  recordedChecks: number;
  expectedChecks: number;
  /** `null` when no checks were recorded in the window. */
  uptimePercent: number | null;
  coveragePercent: number;
  /** True when coverage is low enough that the percentage should be read with care. */
  partialData: boolean;
}

export interface MonitorSummary {
  id: string;
  name: string;
  url: string;
  state: MonitorState;
  displayState: MonitorDisplayState;
  paused: boolean;
  isPublic: boolean;
  intervalSeconds: number;
  consecutiveFailures: number;
  monitoringStale: boolean;
  lastCheckedAt: string | null;
  lastResponseTimeMs: number | null;
  lastStatusCode: number | null;
  lastFailureKind: FailureKind | null;
  lastFailureReason: string | null;
  nextCheckAt: string | null;
  createdAt: string;
  updatedAt: string;
  uptime24h: UptimeSummary;
  openIncidentId: string | null;
}

export interface MonitorListResponse {
  monitors: MonitorSummary[];
  limit: number;
  used: number;
}

export interface CheckRecord {
  id: string;
  scheduledFor: string;
  checkedAt: string;
  outcome: CheckOutcome;
  statusCode: number | null;
  responseTimeMs: number | null;
  failureKind: FailureKind | null;
  failureReason: string | null;
}

export interface IncidentRecord {
  id: string;
  /** First failed check of the streak that became this outage. */
  startedAt: string;
  /** When the third consecutive failure confirmed it and the alert was raised. */
  detectedAt: string;
  /** First successful check after the outage, or `null` while still open. */
  resolvedAt: string | null;
  /** `resolvedAt - startedAt`, or time since `startedAt` while open. */
  durationSeconds: number;
  ongoing: boolean;
  /**
   * Why the incident closed. `RECOVERED` is the only reason that produced a
   * recovery email; the others mean the owner paused or reconfigured the monitor
   * while it was down, so Pingexa stopped counting the outage.
   */
  closeReason: IncidentCloseReason | null;
  causeKind: FailureKind | null;
  causeReason: string | null;
}

export interface NotificationRecord {
  id: string;
  incidentId: string;
  kind: NotificationKind;
  status: NotificationStatus;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
}

export interface MonitorDetailResponse {
  monitor: MonitorSummary;
  uptime: { '24h': UptimeSummary; '7d': UptimeSummary };
  checks: CheckRecord[];
  incidents: IncidentRecord[];
  notifications: NotificationRecord[];
  checkHistoryRetentionDays: number;
}

export interface StatusPageSettings {
  slug: string;
  title: string;
  published: boolean;
  publicUrl: string;
  publishedMonitorIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StatusPageSettingsResponse {
  statusPage: StatusPageSettings;
}

/** Public projection. Deliberately contains no URL, email, or internal detail. */
export interface PublicStatusMonitor {
  id: string;
  name: string;
  displayState: MonitorDisplayState;
  lastCheckedAt: string | null;
  uptime24h: UptimeSummary;
  uptime7d: UptimeSummary;
  recentIncidents: Array<{
    id: string;
    startedAt: string;
    resolvedAt: string | null;
    durationSeconds: number;
    ongoing: boolean;
  }>;
}

export interface PublicStatusPageResponse {
  title: string;
  generatedAt: string;
  overall: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'UNKNOWN';
  monitors: PublicStatusMonitor[];
  intervalSeconds: number;
}

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
}

export interface ReadyResponse {
  status: 'ready' | 'degraded';
  checks: { database: boolean; redis: boolean };
}

/* ------------------------------------------------------------- Overview ---- */

/**
 * One time bucket of check results.
 *
 * Buckets are the honest way to draw a long window without shipping every row:
 * each one reports how many checks actually ran inside it. A bucket in which
 * nothing ran has `recordedChecks: 0` and `avgResponseTimeMs: null` — it is a
 * gap, and must be drawn as one. It is never an implied zero, and never an
 * implied success.
 */
export interface CheckBucket {
  /** Inclusive start of the bucket. */
  startedAt: string;
  /** Exclusive end of the bucket. */
  endedAt: string;
  upChecks: number;
  downChecks: number;
  recordedChecks: number;
  /** Mean response time of the *successful* checks, or `null` if there were none. */
  avgResponseTimeMs: number | null;
}

/** A monitor's recent check results, bucketed for display. */
export interface MonitorTimeline {
  monitorId: string;
  window: UptimeWindow;
  bucketSeconds: number;
  buckets: CheckBucket[];
}

/** An incident plus the monitor it belongs to, for cross-monitor lists. */
export interface IncidentWithMonitor extends IncidentRecord {
  monitorId: string;
  monitorName: string;
}

/**
 * Aggregate activity over a window, computed from recorded checks only.
 *
 * Every field here is a count of rows that exist. Nothing is inferred for a
 * check that never ran, which is why there is no "availability" figure: the
 * per-monitor `UptimeSummary` already carries uptime with its coverage, and
 * averaging those across monitors would produce a number with no defensible
 * meaning.
 */
export interface ActivitySummary {
  windowStart: string;
  windowEnd: string;
  recordedChecks: number;
  upChecks: number;
  downChecks: number;
  /** Incidents whose outage began inside the window. */
  incidentsStarted: number;
  /** Median response time across successful checks, or `null` when there were none. */
  medianResponseTimeMs: number | null;
  /** How many of the account's monitors recorded at least one check in the window. */
  monitorsWithData: number;
}

/** Everything the signed-in overview needs, in one request. */
export interface OverviewResponse {
  monitors: MonitorSummary[];
  limit: number;
  used: number;
  /** Incidents that are open right now, newest first. */
  openIncidents: IncidentWithMonitor[];
  /** Incidents that started in the last 7 days, newest first, bounded. */
  recentIncidents: IncidentWithMonitor[];
  last24h: ActivitySummary;
  /** 24-hour bucketed check history, one entry per monitor. */
  timelines: MonitorTimeline[];
}

/* --------------------------------------------------------------- Alerts ---- */

/** A delivered (or attempted) alert email, with the monitor it was about. */
export interface AlertRecord extends NotificationRecord {
  monitorId: string;
  monitorName: string;
  /** When the outage this alert describes began. */
  incidentStartedAt: string;
}

export interface AlertListResponse {
  alerts: AlertRecord[];
  /** The maximum this endpoint will ever return, so the UI can say so. */
  limit: number;
}
