-- Constraints Prisma's schema language cannot express, but which V1 correctness
-- depends on. Keeping them in a committed migration means a fresh database gets
-- the same guarantees as the development one.

-- 1. A user can never hold more than MAX_MONITORS_PER_USER (3) monitors.
--    Combined with the unique (userId, slot) index Prisma already created, a
--    fourth monitor is physically impossible no matter how requests interleave.
ALTER TABLE "monitors"
  ADD CONSTRAINT "monitors_slot_range" CHECK ("slot" >= 0 AND "slot" <= 2);

-- 2. Only one incident per monitor may be open at a time. This is what stops a
--    second DOWN incident (and therefore a second DOWN alert) being opened while
--    an outage is still unresolved, even under concurrent workers.
CREATE UNIQUE INDEX "incidents_one_open_per_monitor"
  ON "incidents" ("monitorId")
  WHERE "resolvedAt" IS NULL;

-- 3. Sanity constraints on recorded checks: a failed check must say why, and a
--    successful one must not carry a failure reason.
ALTER TABLE "checks"
  ADD CONSTRAINT "checks_failure_fields_consistent" CHECK (
    ("outcome" = 'UP' AND "failureKind" IS NULL)
    OR ("outcome" = 'DOWN' AND "failureKind" IS NOT NULL)
  );

-- 4. Response time, when recorded, is non-negative.
ALTER TABLE "checks"
  ADD CONSTRAINT "checks_response_time_non_negative"
  CHECK ("responseTimeMs" IS NULL OR "responseTimeMs" >= 0);

-- 5. An incident cannot resolve before it started.
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_resolved_after_started"
  CHECK ("resolvedAt" IS NULL OR "resolvedAt" >= "startedAt");

-- 6. Retention and the scheduler both scan on these; keep them cheap.
CREATE INDEX "monitors_due_scan"
  ON "monitors" ("nextCheckAt")
  WHERE "paused" = false;
