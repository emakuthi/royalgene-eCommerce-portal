-- Self-hosted crash reporting for the Android app (business_hub): there's
-- no Play Store / Play Console vitals for this app, and no third-party
-- crash SDK (Crashlytics/Sentry) wired up, so a crash on a tenant's phone
-- was otherwise invisible once it happened. The app POSTs a fatal
-- (uncaught) crash here on its next launch after one occurs; there's no
-- symbolication or dashboarding here — just enough to query directly when
-- investigating a report.
create table if not exists "CrashReport" (
  id uuid primary key default gen_random_uuid(),
  "organizationId" uuid,
  "userId" uuid,
  platform text not null default 'android',
  "appVersionName" text,
  "appVersionCode" integer,
  "deviceModel" text,
  "osVersion" text,
  message text,
  "stackTrace" text not null,
  "occurredAt" timestamptz not null,
  "createdAt" timestamptz not null default now()
);

create index if not exists "CrashReport_organizationId_idx" on "CrashReport" ("organizationId");
create index if not exists "CrashReport_createdAt_desc_idx" on "CrashReport" ("createdAt" desc);

-- Same RLS posture as every other table since 20260910_04: deny-all for the
-- anon/authenticated roles, service-role (used by every API route here)
-- bypasses RLS entirely.
alter table "CrashReport" enable row level security;
