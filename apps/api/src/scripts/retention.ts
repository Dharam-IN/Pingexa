/**
 * One-shot retention cleanup, for running the pass by hand. The worker already
 * runs this on `RETENTION_INTERVAL_MS`; this entrypoint exists for operators who
 * want to force it (for example right after changing a retention setting).
 */
import { prisma } from '../lib/prisma.js';
import { runRetention } from '../monitoring/retention.js';

runRetention()
  .then(async (summary) => {
    console.log(JSON.stringify(summary, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
