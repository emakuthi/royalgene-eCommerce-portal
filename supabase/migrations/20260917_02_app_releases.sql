-- Tracks published Android app builds so the mobile app can check for
-- updates and the portal can serve a public download page. Each row is one
-- APK published by CI on a push to main (see .github/workflows/release.yml
-- in the stock-management-mobile-app repo); the app compares its own
-- BuildConfig.VERSION_CODE against the newest row here for its platform.
create table if not exists "AppRelease" (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'android',
  "versionCode" integer not null,
  "versionName" text not null,
  "apkPath" text not null,
  "apkUrl" text not null,
  "fileSizeBytes" bigint,
  sha256 text,
  changelog text,
  "createdAt" timestamptz not null default now()
);

create unique index if not exists "AppRelease_platform_versionCode_key"
  on "AppRelease" (platform, "versionCode");

create index if not exists "AppRelease_platform_versionCode_desc_idx"
  on "AppRelease" (platform, "versionCode" desc);

-- Same RLS posture as every other table since 20260910_04: deny-all for the
-- anon/authenticated roles, service-role (used by every API route here)
-- bypasses RLS entirely.
alter table "AppRelease" enable row level security;
