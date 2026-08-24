-- Usage-threshold notifications: migration 1 of 1. Dedup ledger only — the
-- actual in-app notification is a normal row in the existing "Alert" table
-- (already used for low-stock alerts etc.), not a new delivery mechanism.
-- One row per (org, limit, threshold, calendar-month period) prevents
-- re-notifying for the same threshold more than once per period, even
-- across concurrent requests (the unique constraint is the real guard —
-- app code treats an insert conflict as "already notified").
--
-- Run manually via the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS "UsageThresholdNotification" (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid NOT NULL REFERENCES "Organization"(id) ON DELETE CASCADE,
  "limitCode"      text NOT NULL,
  threshold        integer NOT NULL,
  period           text NOT NULL,
  "notifiedAt"     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT usage_threshold_notification_unique UNIQUE ("organizationId", "limitCode", threshold, period)
);

CREATE INDEX IF NOT EXISTS usage_threshold_notification_org_idx
  ON "UsageThresholdNotification" ("organizationId");
