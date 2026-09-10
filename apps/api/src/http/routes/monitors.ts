import { Router } from 'express';
import { z } from 'zod';
import {
  CHECK_RETENTION_DAYS,
  MAX_MONITORS_PER_USER,
  createMonitorSchema,
  updateMonitorSchema,
  uptimeWindowSchema,
  type MonitorDetailResponse,
  type MonitorListResponse,
} from '@pingexa/shared';
import {
  createMonitor,
  deleteMonitor,
  getOwnedMonitor,
  listMonitors,
  updateMonitor,
} from '../../domain/monitors.js';
import {
  serialiseCheck,
  serialiseIncident,
  serialiseMonitor,
  serialiseNotification,
} from '../../domain/serializers.js';
import { computeUptime, countChecksInWindow, WINDOW_MS } from '../../domain/uptime.js';
import { prisma } from '../../lib/prisma.js';
import { unauthorized } from '../../lib/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { monitorWriteLimiter } from '../middleware/rateLimit.js';
import { requireAuth, requireVerifiedEmail } from '../middleware/session.js';
import { validateBody } from '../middleware/validate.js';

export const monitorsRouter = Router();

const idParamSchema = z.uuid('Not a valid monitor id');

function requireUserId(req: { auth?: { user: { id: string } } }): string {
  const id = req.auth?.user.id;
  if (!id) throw unauthorized();
  return id;
}

/** Reading monitors only needs a session; creating or editing needs a verified email. */
monitorsRouter.use(requireAuth);

monitorsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const now = new Date();
    const monitors = await listMonitors(userId);
    const ids = monitors.map((monitor) => monitor.id);

    const counts = await countChecksInWindow(ids, new Date(now.getTime() - WINDOW_MS['24h']));
    const openIncidents = await prisma.incident.findMany({
      where: { monitorId: { in: ids }, resolvedAt: null },
      select: { id: true, monitorId: true },
    });
    const openByMonitor = new Map(openIncidents.map((row) => [row.monitorId, row.id]));

    const body: MonitorListResponse = {
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
            counts: counts.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
          }),
        }),
      ),
      limit: MAX_MONITORS_PER_USER,
      used: monitors.length,
    };
    res.status(200).json(body);
  }),
);

monitorsRouter.post(
  '/',
  requireVerifiedEmail,
  monitorWriteLimiter,
  validateBody(createMonitorSchema),
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const input = req.body as { name: string; url: string; isPublic?: boolean };
    const monitor = await createMonitor({
      userId,
      name: input.name,
      url: input.url,
      ...(input.isPublic === undefined ? {} : { isPublic: input.isPublic }),
    });
    const now = new Date();
    res.status(201).json({
      monitor: serialiseMonitor({
        monitor,
        now,
        openIncidentId: null,
        uptime24h: computeUptime({
          window: '24h',
          now,
          monitorCreatedAt: monitor.createdAt,
          intervalSeconds: monitor.intervalSeconds,
          counts: { upChecks: 0, downChecks: 0 },
        }),
      }),
    });
  }),
);

monitorsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const monitorId = idParamSchema.parse(req.params.id);
    const monitor = await getOwnedMonitor(userId, monitorId);
    const now = new Date();

    const since7d = new Date(now.getTime() - WINDOW_MS['7d']);
    const since24h = new Date(now.getTime() - WINDOW_MS['24h']);

    const [checks, incidents, counts24h, counts7d] = await Promise.all([
      prisma.check.findMany({
        where: { monitorId: monitor.id, checkedAt: { gte: since7d } },
        orderBy: { checkedAt: 'asc' },
      }),
      prisma.incident.findMany({
        where: { monitorId: monitor.id },
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
      countChecksInWindow([monitor.id], since24h),
      countChecksInWindow([monitor.id], since7d),
    ]);

    const notifications = await prisma.notification.findMany({
      where: { incidentId: { in: incidents.map((incident) => incident.id) } },
      orderBy: { createdAt: 'desc' },
    });

    const openIncident = incidents.find((incident) => incident.resolvedAt === null);

    const body: MonitorDetailResponse = {
      monitor: serialiseMonitor({
        monitor,
        now,
        openIncidentId: openIncident?.id ?? null,
        uptime24h: computeUptime({
          window: '24h',
          now,
          monitorCreatedAt: monitor.createdAt,
          intervalSeconds: monitor.intervalSeconds,
          counts: counts24h.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
        }),
      }),
      uptime: {
        '24h': computeUptime({
          window: '24h',
          now,
          monitorCreatedAt: monitor.createdAt,
          intervalSeconds: monitor.intervalSeconds,
          counts: counts24h.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
        }),
        '7d': computeUptime({
          window: '7d',
          now,
          monitorCreatedAt: monitor.createdAt,
          intervalSeconds: monitor.intervalSeconds,
          counts: counts7d.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
        }),
      },
      checks: checks.map(serialiseCheck),
      incidents: incidents.map((incident) => serialiseIncident(incident, now)),
      notifications: notifications.map(serialiseNotification),
      checkHistoryRetentionDays: CHECK_RETENTION_DAYS,
    };
    res.status(200).json(body);
  }),
);

monitorsRouter.get(
  '/:id/checks',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const monitorId = idParamSchema.parse(req.params.id);
    const monitor = await getOwnedMonitor(userId, monitorId);
    const window = uptimeWindowSchema.parse(req.query.window ?? '24h');

    const since = new Date(Date.now() - WINDOW_MS[window]);
    const checks = await prisma.check.findMany({
      where: { monitorId: monitor.id, checkedAt: { gte: since } },
      orderBy: { checkedAt: 'asc' },
    });
    res.status(200).json({ window, checks: checks.map(serialiseCheck) });
  }),
);

monitorsRouter.get(
  '/:id/incidents',
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const monitorId = idParamSchema.parse(req.params.id);
    const monitor = await getOwnedMonitor(userId, monitorId);
    const now = new Date();
    const incidents = await prisma.incident.findMany({
      where: { monitorId: monitor.id },
      orderBy: { startedAt: 'desc' },
      take: 100,
    });
    res
      .status(200)
      .json({ incidents: incidents.map((incident) => serialiseIncident(incident, now)) });
  }),
);

monitorsRouter.patch(
  '/:id',
  requireVerifiedEmail,
  monitorWriteLimiter,
  validateBody(updateMonitorSchema),
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const monitorId = idParamSchema.parse(req.params.id);
    const changes = req.body as {
      name?: string;
      url?: string;
      paused?: boolean;
      isPublic?: boolean;
    };

    const monitor = await updateMonitor({
      userId,
      monitorId,
      ...(changes.name === undefined ? {} : { name: changes.name }),
      ...(changes.url === undefined ? {} : { url: changes.url }),
      ...(changes.paused === undefined ? {} : { paused: changes.paused }),
      ...(changes.isPublic === undefined ? {} : { isPublic: changes.isPublic }),
    });

    const now = new Date();
    const counts = await countChecksInWindow([monitor.id], new Date(now.getTime() - WINDOW_MS['24h']));
    const openIncident = await prisma.incident.findFirst({
      where: { monitorId: monitor.id, resolvedAt: null },
      select: { id: true },
    });

    res.status(200).json({
      monitor: serialiseMonitor({
        monitor,
        now,
        openIncidentId: openIncident?.id ?? null,
        uptime24h: computeUptime({
          window: '24h',
          now,
          monitorCreatedAt: monitor.createdAt,
          intervalSeconds: monitor.intervalSeconds,
          counts: counts.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
        }),
      }),
    });
  }),
);

monitorsRouter.delete(
  '/:id',
  requireVerifiedEmail,
  monitorWriteLimiter,
  asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const monitorId = idParamSchema.parse(req.params.id);
    await deleteMonitor(userId, monitorId);
    res.status(204).end();
  }),
);
