import {
  DEFAULT_MONITOR_INTERVAL_SECONDS,
  MAX_MONITORS_PER_USER,
  STALE_INTERVAL_MULTIPLIER,
  type CheckRecord,
  type IncidentRecord,
  type MonitorDisplayState,
  type MonitorSummary,
  type NotificationRecord,
  type PublicStatusMonitor,
  type SessionUser,
  type UptimeSummary,
} from '@pingexa/shared';
import type { Check, Incident, Monitor, Notification } from '../generated/prisma/client.js';
import type { AuthenticatedUser } from './sessions.js';
import { isMonitoringStale } from './uptime.js';
import { secondsBetween } from '../lib/time.js';

export function serialiseUser(user: AuthenticatedUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

export function displayState(monitor: Monitor, stale: boolean): MonitorDisplayState {
  if (monitor.paused) return 'PAUSED';
  if (stale) return 'STALE';
  return monitor.state;
}

export interface SerialiseMonitorArgs {
  readonly monitor: Monitor;
  readonly uptime24h: UptimeSummary;
  readonly openIncidentId: string | null;
  readonly now: Date;
}

export function serialiseMonitor(args: SerialiseMonitorArgs): MonitorSummary {
  const { monitor } = args;
  const stale = isMonitoringStale({
    paused: monitor.paused,
    nextCheckAt: monitor.nextCheckAt,
    lastCheckedAt: monitor.lastCheckedAt,
    createdAt: monitor.createdAt,
    intervalSeconds: monitor.intervalSeconds,
    now: args.now,
    staleMultiplier: STALE_INTERVAL_MULTIPLIER,
  });

  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    state: monitor.state,
    displayState: displayState(monitor, stale),
    paused: monitor.paused,
    isPublic: monitor.isPublic,
    intervalSeconds: monitor.intervalSeconds,
    consecutiveFailures: monitor.consecutiveFailures,
    monitoringStale: stale,
    lastCheckedAt: monitor.lastCheckedAt?.toISOString() ?? null,
    lastResponseTimeMs: monitor.lastResponseTimeMs,
    lastStatusCode: monitor.lastStatusCode,
    lastFailureKind: monitor.lastFailureKind,
    lastFailureReason: monitor.lastFailureReason,
    nextCheckAt: monitor.nextCheckAt?.toISOString() ?? null,
    createdAt: monitor.createdAt.toISOString(),
    updatedAt: monitor.updatedAt.toISOString(),
    uptime24h: args.uptime24h,
    openIncidentId: args.openIncidentId,
  };
}

export function serialiseCheck(check: Check): CheckRecord {
  return {
    id: check.id,
    scheduledFor: check.scheduledFor.toISOString(),
    checkedAt: check.checkedAt.toISOString(),
    outcome: check.outcome,
    statusCode: check.statusCode,
    responseTimeMs: check.responseTimeMs,
    failureKind: check.failureKind,
    failureReason: check.failureReason,
  };
}

export function serialiseIncident(incident: Incident, now: Date): IncidentRecord {
  const end = incident.resolvedAt ?? now;
  return {
    id: incident.id,
    startedAt: incident.startedAt.toISOString(),
    detectedAt: incident.detectedAt.toISOString(),
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    durationSeconds: secondsBetween(incident.startedAt, end),
    ongoing: incident.resolvedAt === null,
    closeReason: incident.closeReason,
    causeKind: incident.causeKind,
    causeReason: incident.causeReason,
  };
}

export function serialiseNotification(notification: Notification): NotificationRecord {
  return {
    id: notification.id,
    incidentId: notification.incidentId,
    kind: notification.kind,
    status: notification.status,
    attempts: notification.attempts,
    sentAt: notification.sentAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}

/**
 * Public projection for a status page.
 *
 * This function is the privacy boundary: it takes the full monitor row and
 * returns only the fields a stranger may see. It deliberately never touches
 * `url`, the owner's email, failure reasons, status codes, or slugs — a failure
 * reason can contain the host name, and a status code can leak how a private
 * endpoint behaves.
 */
export function serialisePublicMonitor(args: {
  readonly monitor: Monitor;
  readonly uptime24h: UptimeSummary;
  readonly uptime7d: UptimeSummary;
  readonly incidents: readonly Incident[];
  readonly now: Date;
}): PublicStatusMonitor {
  const stale = isMonitoringStale({
    paused: args.monitor.paused,
    nextCheckAt: args.monitor.nextCheckAt,
    lastCheckedAt: args.monitor.lastCheckedAt,
    createdAt: args.monitor.createdAt,
    intervalSeconds: args.monitor.intervalSeconds,
    now: args.now,
    staleMultiplier: STALE_INTERVAL_MULTIPLIER,
  });

  return {
    id: args.monitor.id,
    name: args.monitor.name,
    displayState: displayState(args.monitor, stale),
    lastCheckedAt: args.monitor.lastCheckedAt?.toISOString() ?? null,
    uptime24h: args.uptime24h,
    uptime7d: args.uptime7d,
    recentIncidents: args.incidents.map((incident) => ({
      id: incident.id,
      startedAt: incident.startedAt.toISOString(),
      resolvedAt: incident.resolvedAt?.toISOString() ?? null,
      durationSeconds: secondsBetween(incident.startedAt, incident.resolvedAt ?? args.now),
      ongoing: incident.resolvedAt === null,
    })),
  };
}

export const MONITOR_LIMIT = MAX_MONITORS_PER_USER;
export const PRODUCT_INTERVAL_SECONDS = DEFAULT_MONITOR_INTERVAL_SECONDS;
