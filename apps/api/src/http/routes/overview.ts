import { Router } from 'express';
import { z } from 'zod';
import {
  MAX_MONITORS_PER_USER,
  type AlertListResponse,
  type AlertRecord,
  type IncidentWithMonitor,
  type OverviewResponse,
} from '@pingexa/shared';
import { listMonitors } from '../../domain/monitors.js';
import { serialiseIncident, serialiseMonitor } from '../../domain/serializers.js';
import { bucketChecks, summariseActivity } from '../../domain/activity.js';
import { computeUptime, countChecksInWindow, WINDOW_MS } from '../../domain/uptime.js';
import { prisma } from '../../lib/prisma.js';
import { unauthorized } from '../../lib/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { requireAuth } from '../middleware/session.js';

/**
 * Read-only aggregates for the signed-in app.
 *
 * Both endpoints exist because the screens they serve need data *across* the
 * account's monitors, which `/api/monitors/:id` cannot answer without the
 * client fanning out one request per monitor and stitching the results
 * together. Neither adds a stored field, a migration, or a new capability:
 * every number below is counted from rows the product already writes.
 *
 * Both are scoped by the session user at the query level — `monitorId in
 * (monitors owned by this user)` for the overview, `userId` for alerts — so
 * there is no id a caller can supply to reach someone else's data.
 *
 * They are two narrowly mounted routers rather than one mounted at `/api`. A
 * single router at `/api` carrying a router-level `requireAuth` answers 401 for
 * every unmatched `/api/...` path, because the guard runs before the request can
 * fall through to the not-found handler — which turns a typo into an
 * authentication error. Mounting each router on its own path keeps the guard on
 * exactly the routes it belongs to.
 */
export const overviewRouter = Router();
export const alertsRouter = Router();

overviewRouter.use(requireAuth);
alertsRouter.use(requireAuth);

function requireUserId(req: { auth?: { user: { id: string } } }): string {
  const id = req.auth?.user.id;
  if (!id) throw unauthorized();
  return id;
}

/** Hard ceiling on the cross-monitor incident lists, so the payload is bounded. */
const RECENT_INCIDENT_LIMIT = 10;

overviewRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const now = new Date();
    const since24h = new Date(now.getTime() - WINDOW_MS['24h']);
    const since7d = new Date(now.getTime() - WINDOW_MS['7d']);

    const monitors = await listMonitors(userId);
    const ids = monitors.map((monitor) => monitor.id);
    const nameById = new Map(monitors.map((monitor) => [monitor.id, monitor.name]));

    // An account with no monitors still gets a well-formed response; skipping
    // the queries keeps `IN ()` out of the database.
    const [counts24h, incidents, checks24h] = await Promise.all([
      countChecksInWindow(ids, since24h),
      ids.length === 0
        ? Promise.resolve([])
        : prisma.incident.findMany({
            where: {
              monitorId: { in: ids },
              OR: [{ startedAt: { gte: since7d } }, { resolvedAt: null }],
            },
            orderBy: { startedAt: 'desc' },
            // Bounded independently of the display limit so "how many started in
            // the window" stays countable without loading the whole table.
            take: 200,
          }),
      ids.length === 0
        ? Promise.resolve([])
        : prisma.check.findMany({
            where: { monitorId: { in: ids }, checkedAt: { gte: since24h } },
            select: {
              monitorId: true,
              checkedAt: true,
              outcome: true,
              responseTimeMs: true,
            },
            orderBy: { checkedAt: 'asc' },
          }),
    ]);

    const openByMonitor = new Map(
      incidents.filter((row) => row.resolvedAt === null).map((row) => [row.monitorId, row.id]),
    );

    const withMonitor = (incident: (typeof incidents)[number]): IncidentWithMonitor => ({
      ...serialiseIncident(incident, now),
      monitorId: incident.monitorId,
      monitorName: nameById.get(incident.monitorId) ?? '',
    });

    const body: OverviewResponse = {
      monitors: monitors.map((monitor) =>
        serialiseMonitor({
          monitor,
          now,
          openIncidentId: openByMonitor.get(monitor.id) ?? null,
          uptime24h: computeUptime({
            window: '24h',
            now,
            monitorCreatedAt: monitor.createdAt,
            intervalSeconds: monitor.intervalSeconds,
            counts: counts24h.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
          }),
        }),
      ),
      limit: MAX_MONITORS_PER_USER,
      used: monitors.length,
      openIncidents: incidents
        .filter((incident) => incident.resolvedAt === null)
        .map(withMonitor),
      recentIncidents: incidents
        .filter((incident) => incident.startedAt >= since7d)
        .slice(0, RECENT_INCIDENT_LIMIT)
        .map(withMonitor),
      last24h: summariseActivity({
        window: '24h',
        now,
        checks: checks24h,
        incidentsStarted: incidents.filter((incident) => incident.startedAt >= since24h).length,
      }),
      timelines: monitors.map((monitor) =>
        bucketChecks({
          monitorId: monitor.id,
          window: '24h',
          now,
          checks: checks24h.filter((check) => check.monitorId === monitor.id),
        }),
      ),
    };

    res.status(200).json(body);
  }),
);

const alertQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

alertsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const { limit } = alertQuerySchema.parse(req.query);

    /*
     * Scoped by `userId` on the notification row itself, which is the column the
     * alert was written with. Going via the incident would work too but reads as
     * if ownership were transitive; it is not, it is stored.
     */
    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        incident: {
          select: {
            startedAt: true,
            monitorId: true,
            monitor: { select: { name: true } },
          },
        },
      },
    });

    const alerts: AlertRecord[] = notifications.map((notification) => ({
      id: notification.id,
      incidentId: notification.incidentId,
      kind: notification.kind,
      status: notification.status,
      attempts: notification.attempts,
      sentAt: notification.sentAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
      monitorId: notification.incident.monitorId,
      monitorName: notification.incident.monitor.name,
      incidentStartedAt: notification.incident.startedAt.toISOString(),
      /*
       * `lastError` is deliberately not projected. It is an SMTP diagnostic
       * written for the operator's logs, and it can carry provider hostnames and
       * raw server replies. The UI needs "did this arrive", which `status` and
       * `attempts` already answer.
       */
    }));

    const body: AlertListResponse = { alerts, limit };
    res.status(200).json(body);
  }),
);
