/**
 * Local demo data.
 *
 * Everything this script creates is deliberately marked so it can never be
 * mistaken for real application data:
 *   * the account is `SEED_USER_EMAIL` (default `demo@pingexa.local`, a
 *     non-routable address);
 *   * every monitor name is prefixed `[DEMO]`;
 *   * the generated history is written with a `seededAt` marker in the log so
 *     it is obvious where it came from.
 *
 * It refuses to run when NODE_ENV=production, and it never touches rows that do
 * not belong to the demo account.
 */
import { env, isProduction } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/crypto.js';
import { generateSlug } from '../lib/crypto.js';
import { addMs, DAY_MS, HOUR_MS, MINUTE_MS } from '../lib/time.js';
import { createUrlGuard } from '../monitoring/urlGuard.js';

const DEMO_PREFIX = '[DEMO]';

/**
 * The seed writes synthetic history for hostnames it never contacts, so it uses
 * a guard with a stubbed resolver rather than depending on the machine having
 * working DNS. The addresses are public, so the production address policy still
 * applies to everything except the lookup itself.
 */
const seedGuard = createUrlGuard({
  resolve: async () => [{ address: '93.184.215.14', family: 4 }],
});

interface SeedMonitorSpec {
  readonly name: string;
  readonly url: string;
  readonly isPublic: boolean;
  readonly story: 'healthy' | 'recovered-outage' | 'currently-down';
}

/*
 * The URLs are chosen so a *live* check agrees with the synthetic story. The
 * worker keeps checking these monitors after seeding, and if a real result
 * contradicted the seeded state it would immediately overwrite it — a monitor
 * seeded as "currently down" pointing at a URL that answers 200 flips to up
 * within five minutes, which makes the demo confusing rather than illustrative.
 *
 * `example.com` answers 200 at `/` and 404 at an unknown path, so:
 *   healthy / recovered-outage -> a path that answers 200 (the outage is history)
 *   currently-down            -> a path that answers 404 (the outage continues)
 */
const SPECS: readonly SeedMonitorSpec[] = [
  {
    name: `${DEMO_PREFIX} Marketing site`,
    url: 'https://example.com/',
    isPublic: true,
    story: 'healthy',
  },
  {
    name: `${DEMO_PREFIX} API endpoint`,
    url: 'https://example.com/?pingexa-demo=api',
    isPublic: true,
    story: 'recovered-outage',
  },
  {
    name: `${DEMO_PREFIX} Staging server`,
    url: 'https://example.com/pingexa-demo-missing-page',
    isPublic: false,
    story: 'currently-down',
  },
];

async function main(): Promise<void> {
  if (isProduction) {
    throw new Error('Refusing to seed demo data with NODE_ENV=production');
  }

  const now = new Date();
  const email = env.SEED_USER_EMAIL.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    // Only the demo account's own rows are removed, and only its own.
    await prisma.user.delete({ where: { id: existing.id } });
    console.log(`removed the previous demo account (${email}) and its data`);
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(env.SEED_USER_PASSWORD),
      emailVerifiedAt: now,
      createdAt: addMs(now, -10 * DAY_MS),
    },
  });

  await prisma.statusPage.create({
    data: {
      userId: user.id,
      slug: generateSlug(),
      title: `${DEMO_PREFIX} Acme status`,
      published: true,
    },
  });

  for (const [slot, spec] of SPECS.entries()) {
    const approval = await seedGuard.check(spec.url);
    if (!approval.ok) throw new Error(`seed URL rejected by the guard: ${approval.message}`);

    const monitor = await prisma.monitor.create({
      data: {
        userId: user.id,
        slot,
        name: spec.name,
        url: approval.url,
        isPublic: spec.isPublic,
        intervalSeconds: env.MONITOR_INTERVAL_SECONDS,
        // Matches the 24 hours of history written below, so the 7-day window
        // reports full coverage rather than flagging six days of "missing"
        // checks for a monitor that did not exist then.
        createdAt: addMs(now, -24 * HOUR_MS),
        state: 'PENDING',
        nextCheckAt: now,
      },
    });
    await writeHistory(monitor.id, user.id, spec.story, now);
  }

  const page = await prisma.statusPage.findUniqueOrThrow({ where: { userId: user.id } });
  console.log('');
  console.log('Demo data created. Every name is prefixed with [DEMO].');
  console.log(`  sign in as: ${email}`);
  console.log(`  password:   ${env.SEED_USER_PASSWORD} (from SEED_USER_PASSWORD)`);
  console.log(`  status page: ${env.PUBLIC_APP_URL}/status/${page.slug}`);
  console.log(`  seededAt:    ${now.toISOString()}`);
}

/**
 * Writes 24 hours of synthetic 5-minute checks plus the incidents they imply.
 * The rows are ordinary rows, which is the point: the dashboard renders real
 * data, not a special demo mode.
 */
async function writeHistory(
  monitorId: string,
  userId: string,
  story: SeedMonitorSpec['story'],
  now: Date,
): Promise<void> {
  const interval = 5 * MINUTE_MS;
  const slots = 24 * 12; // 24 hours at five minutes
  const checks: Array<{
    monitorId: string;
    scheduledFor: Date;
    startedAt: Date;
    checkedAt: Date;
    outcome: 'UP' | 'DOWN';
    statusCode: number | null;
    responseTimeMs: number | null;
    failureKind: 'HTTP_ERROR' | 'TIMEOUT' | null;
    failureReason: string | null;
  }> = [];

  // Which slots fail, counted back from now.
  const failingSlots = new Set<number>();
  if (story === 'recovered-outage') {
    for (let index = 40; index <= 48; index += 1) failingSlots.add(index);
  }
  if (story === 'currently-down') {
    for (let index = 0; index <= 6; index += 1) failingSlots.add(index);
  }

  for (let index = slots - 1; index >= 0; index -= 1) {
    const at = addMs(now, -index * interval);
    const failed = failingSlots.has(index);
    const latency = 90 + Math.round(60 * Math.sin(index / 7)) + (index % 5) * 4;
    checks.push({
      monitorId,
      scheduledFor: at,
      startedAt: addMs(at, -latency),
      checkedAt: at,
      outcome: failed ? 'DOWN' : 'UP',
      statusCode: failed ? 503 : 200,
      responseTimeMs: failed ? null : Math.max(35, latency),
      failureKind: failed ? 'HTTP_ERROR' : null,
      failureReason: failed ? 'Responded with HTTP 503' : null,
    });
  }
  await prisma.check.createMany({ data: checks });

  if (story === 'healthy') {
    const last = checks.at(-1)!;
    await prisma.monitor.update({
      where: { id: monitorId },
      data: {
        state: 'UP',
        lastCheckedAt: last.checkedAt,
        lastStatusCode: 200,
        lastResponseTimeMs: last.responseTimeMs,
      },
    });
    return;
  }

  if (story === 'recovered-outage') {
    const startedAt = addMs(now, -48 * interval);
    const detectedAt = addMs(now, -46 * interval);
    const resolvedAt = addMs(now, -39 * interval);
    const incident = await prisma.incident.create({
      data: {
        monitorId,
        startedAt,
        detectedAt,
        resolvedAt,
        closeReason: 'RECOVERED',
        causeKind: 'HTTP_ERROR',
        causeReason: 'Responded with HTTP 503',
      },
    });
    await prisma.notification.createMany({
      data: [
        {
          incidentId: incident.id,
          userId,
          kind: 'DOWN',
          status: 'SENT',
          attempts: 1,
          sentAt: detectedAt,
        },
        {
          incidentId: incident.id,
          userId,
          kind: 'RECOVERY',
          status: 'SENT',
          attempts: 1,
          sentAt: resolvedAt,
        },
      ],
    });
    const last = checks.at(-1)!;
    await prisma.monitor.update({
      where: { id: monitorId },
      data: {
        state: 'UP',
        lastCheckedAt: last.checkedAt,
        lastStatusCode: 200,
        lastResponseTimeMs: last.responseTimeMs,
      },
    });
    return;
  }

  const startedAt = addMs(now, -6 * interval);
  const detectedAt = addMs(now, -4 * interval);
  const incident = await prisma.incident.create({
    data: {
      monitorId,
      startedAt,
      detectedAt,
      causeKind: 'HTTP_ERROR',
      causeReason: 'Responded with HTTP 503',
    },
  });
  await prisma.notification.create({
    data: {
      incidentId: incident.id,
      userId,
      kind: 'DOWN',
      status: 'SENT',
      attempts: 1,
      sentAt: detectedAt,
    },
  });
  await prisma.monitor.update({
    where: { id: monitorId },
    data: {
      state: 'DOWN',
      consecutiveFailures: 7,
      failingSince: startedAt,
      lastCheckedAt: now,
      lastStatusCode: 503,
      lastResponseTimeMs: null,
      lastFailureKind: 'HTTP_ERROR',
      lastFailureReason: 'Responded with HTTP 503',
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
