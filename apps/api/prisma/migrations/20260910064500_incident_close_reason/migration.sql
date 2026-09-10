-- An incident can stop being open for three different reasons, and only one of
-- them is a recovery. Without this distinction, pausing a monitor mid-outage
-- would either leave the incident open forever (inflating its duration) or send
-- a recovery email for something that never recovered.
CREATE TYPE "IncidentCloseReason" AS ENUM ('RECOVERED', 'MONITOR_RECONFIGURED', 'MONITOR_PAUSED');

ALTER TABLE "incidents" ADD COLUMN "closeReason" "IncidentCloseReason";

-- resolvedAt and closeReason are set together, always.
ALTER TABLE "incidents"
  ADD CONSTRAINT "incidents_close_reason_with_resolved" CHECK (
    ("resolvedAt" IS NULL AND "closeReason" IS NULL)
    OR ("resolvedAt" IS NOT NULL AND "closeReason" IS NOT NULL)
  );
