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
