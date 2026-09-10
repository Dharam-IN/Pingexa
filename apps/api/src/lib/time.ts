export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addSeconds(date: Date, seconds: number): Date {
  return addMs(date, seconds * SECOND_MS);
}

export function addDays(date: Date, days: number): Date {
  return addMs(date, days * DAY_MS);
}

export function secondsBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / SECOND_MS));
}

/**
 * Aligns a timestamp down to the nearest interval boundary since the Unix epoch.
 *
 * Scheduled checks are stored under their slot, not their dispatch time, so a
 * job that runs late still records against the slot it was scheduled for. That
 * is what makes `(monitorId, scheduledFor)` a stable idempotency key.
 */
export function floorToInterval(date: Date, intervalSeconds: number): Date {
  const intervalMs = intervalSeconds * SECOND_MS;
  return new Date(Math.floor(date.getTime() / intervalMs) * intervalMs);
}
