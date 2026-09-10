import { Router } from 'express';
import {
  DEFAULT_MONITOR_INTERVAL_SECONDS,
  updateStatusPageSchema,
  type PublicStatusPageResponse,
  type StatusPageSettingsResponse,
} from '@pingexa/shared';
import {
  findPublishedStatusPage,
  getOrCreateStatusPage,
  publicStatusUrl,
  rotateStatusPageSlug,
  updateStatusPage,
} from '../../domain/statusPage.js';
import { serialisePublicMonitor } from '../../domain/serializers.js';
import { computeUptime, countChecksInWindow, WINDOW_MS } from '../../domain/uptime.js';
import { prisma } from '../../lib/prisma.js';
import { notFound, unauthorized } from '../../lib/errors.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { publicLimiter } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/session.js';
import { validateBody } from '../middleware/validate.js';

export const statusPageRouter = Router();
export const publicStatusRouter = Router();

async function settingsPayload(userId: string, email: string): Promise<StatusPageSettingsResponse> {
  const page = await getOrCreateStatusPage(userId, email);
  const published = await prisma.monitor.findMany({
    where: { userId, isPublic: true },
    select: { id: true },
    orderBy: { slot: 'asc' },
  });
  return {
    statusPage: {
      slug: page.slug,
      title: page.title,
      published: page.published,
      publicUrl: publicStatusUrl(page.slug),
      publishedMonitorIds: published.map((monitor) => monitor.id),
      createdAt: page.createdAt.toISOString(),
      updatedAt: page.updatedAt.toISOString(),
    },
  };
}

statusPageRouter.use(requireAuth);

statusPageRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.status(200).json(await settingsPayload(req.auth.user.id, req.auth.user.email));
  }),
);

statusPageRouter.patch(
  '/',
  validateBody(updateStatusPageSchema),
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const changes = req.body as { title?: string; published?: boolean };
    await getOrCreateStatusPage(req.auth.user.id, req.auth.user.email);
    await updateStatusPage(req.auth.user.id, changes);
    res.status(200).json(await settingsPayload(req.auth.user.id, req.auth.user.email));
  }),
);

statusPageRouter.post(
  '/rotate-slug',
  asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    await getOrCreateStatusPage(req.auth.user.id, req.auth.user.email);
    await rotateStatusPageSlug(req.auth.user.id);
    res.status(200).json(await settingsPayload(req.auth.user.id, req.auth.user.email));
  }),
);

/**
 * The public status page. No session, no cookies needed, no ownership context.
 *
 * The response is built from `serialisePublicMonitor`, which is the single
 * privacy boundary: it never receives or emits URLs, emails, failure reasons,
 * status codes or slugs. Only monitors the owner explicitly marked
 * `isPublic` are included, and only while the page itself is published.
 */
publicStatusRouter.get(
  '/:slug',
  publicLimiter,
  asyncHandler(async (req, res) => {
    const slug = String(req.params.slug ?? '');
    const page = await findPublishedStatusPage(slug);
    if (!page) throw notFound('This status page is not available.');

    const monitors = await prisma.monitor.findMany({
      where: { userId: page.userId, isPublic: true },
      orderBy: { slot: 'asc' },
    });

    const now = new Date();
    const ids = monitors.map((monitor) => monitor.id);
    const [counts24h, counts7d, incidents] = await Promise.all([
      countChecksInWindow(ids, new Date(now.getTime() - WINDOW_MS['24h'])),
      countChecksInWindow(ids, new Date(now.getTime() - WINDOW_MS['7d'])),
      ids.length === 0
        ? Promise.resolve([])
        : prisma.incident.findMany({
            where: { monitorId: { in: ids }, startedAt: { gte: new Date(now.getTime() - WINDOW_MS['7d']) } },
            orderBy: { startedAt: 'desc' },
            take: 60,
          }),
    ]);

    const serialised = monitors.map((monitor) =>
      serialisePublicMonitor({
        monitor,
        now,
        uptime24h: computeUptime({
          window: '24h',
          now,
          monitorCreatedAt: monitor.createdAt,
          intervalSeconds: monitor.intervalSeconds,
          counts: counts24h.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
        }),
        uptime7d: computeUptime({
          window: '7d',
          now,
          monitorCreatedAt: monitor.createdAt,
          intervalSeconds: monitor.intervalSeconds,
          counts: counts7d.get(monitor.id) ?? { upChecks: 0, downChecks: 0 },
        }),
        incidents: incidents.filter((incident) => incident.monitorId === monitor.id).slice(0, 10),
      }),
    );

    const body: PublicStatusPageResponse = {
      title: page.title,
      generatedAt: now.toISOString(),
      overall: overallState(serialised.map((monitor) => monitor.displayState)),
      monitors: serialised,
      intervalSeconds: DEFAULT_MONITOR_INTERVAL_SECONDS,
    };

    // Public and cacheable for a short time; the underlying data only changes
    // every 5 minutes, and this endpoint is unauthenticated.
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.status(200).json(body);
  }),
);

function overallState(
  states: readonly string[],
): PublicStatusPageResponse['overall'] {
  if (states.length === 0) return 'UNKNOWN';
  if (states.every((state) => state === 'UP')) return 'OPERATIONAL';
  if (states.every((state) => state === 'DOWN')) return 'DOWN';
  if (states.some((state) => state === 'DOWN')) return 'DEGRADED';
  if (states.some((state) => state === 'UP')) return 'DEGRADED';
  return 'UNKNOWN';
}
