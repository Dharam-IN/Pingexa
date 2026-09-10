import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { addDays } from '../lib/time.js';
import { purgeDeadSessions } from '../domain/sessions.js';
import { purgeExpiredAuthTokens } from '../domain/authTokens.js';

/**
 * Automated retention cleanup, run periodically by the worker.
 *
 * Checks are the only high-volume table: one row per monitor per 5 minutes is
 * ~2 000 rows per monitor per week. Incidents are kept far longer because they
 * are the interesting history and there are very few of them.
 *
 * Open incidents are never deleted, however old they are — deleting one would
 * silently drop an ongoing outage from the record.
 */

export interface RetentionSummary {
  readonly checksDeleted: number;
  readonly incidentsDeleted: number;
  readonly sessionsDeleted: number;
  readonly authTokensDeleted: number;
  readonly checkCutoff: string;
  readonly incidentCutoff: string;
}

export async function runRetention(now = new Date()): Promise<RetentionSummary> {
  const checkCutoff = addDays(now, -env.CHECK_RETENTION_DAYS);
  const incidentCutoff = addDays(now, -env.INCIDENT_RETENTION_DAYS);

  const checks = await prisma.check.deleteMany({ where: { checkedAt: { lt: checkCutoff } } });
  const incidents = await prisma.incident.deleteMany({
    where: { startedAt: { lt: incidentCutoff }, resolvedAt: { not: null } },
  });
  const sessionsDeleted = await purgeDeadSessions(now);
  const authTokensDeleted = await purgeExpiredAuthTokens(now);

  return {
    checksDeleted: checks.count,
    incidentsDeleted: incidents.count,
    sessionsDeleted,
    authTokensDeleted,
    checkCutoff: checkCutoff.toISOString(),
    incidentCutoff: incidentCutoff.toISOString(),
  };
}
