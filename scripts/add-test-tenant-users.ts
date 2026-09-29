// Adds per-tester accounts to the closed-testing sandbox tenant so that when a
// tester taps "Continue with Google", the app matches their EXISTING User row
// (by email) and drops them into the shared demo shop — instead of
// auto-provisioning them a brand-new workspace of their own.
//
// Each account is created with a fallback password too, so a tester can still
// sign in with email+password if Google Sign-In isn't available in the Play
// build (e.g. the OAuth client is missing the Play App Signing SHA-1).
//
// IMPORTANT: this only works for Gmail addresses that DON'T already have an
// account here — the global-unique email index will reject any that do, and
// those get reported and skipped (no schema change is made).
//
// Usage:
//   npx tsx scripts/add-test-tenant-users.ts alice@gmail.com bob@gmail.com ...
//   (or set TESTER_EMAILS="a@gmail.com,b@gmail.com" and run with no args)

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

function loadEnvFile(filename: string) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

// The tenant provisioned by seed-test-tenant.ts.
const ORG_SLUG = 'testers';
// Shared fallback password for every tester account (change if you like).
const FALLBACK_PASSWORD = process.env.TESTER_PASSWORD || 'RoyalTrackTest1';

async function main() {
  const emails = (process.argv.slice(2).length ? process.argv.slice(2) : (process.env.TESTER_EMAILS || '').split(','))
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length === 0) {
    console.error('Provide tester emails as args or TESTER_EMAILS="a@x.com,b@x.com".');
    process.exit(1);
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: org } = await sb.from('Organization').select('id').eq('slug', ORG_SLUG).maybeSingle();
  if (!org) throw new Error(`Test tenant "${ORG_SLUG}" not found — run seed-test-tenant.ts first.`);
  const { data: shop } = await sb.from('Shop').select('id').eq('organizationId', org.id).maybeSingle();
  if (!shop) throw new Error('Test tenant has no shop.');

  const now = new Date().toISOString();
  const hash = await bcrypt.hash(FALLBACK_PASSWORD, 10);

  let added = 0;
  for (const email of emails) {
    // Pre-flight: an email that already exists anywhere can't be added here
    // (global-unique index), and Google login would sign them into that
    // existing account instead of this shop — flag it clearly.
    const { data: taken } = await sb.from('User').select('id, organizationId').eq('email', email).maybeSingle();
    if (taken) {
      console.warn(`⚠ SKIP ${email} — already has an account (org ${taken.organizationId ?? 'platform'}). Google login won't land here; use a fresh Gmail.`);
      continue;
    }

    const userId = uuidv4();
    const { error: uErr } = await sb.from('User').insert([{
      id: userId, email, password: hash, name: email.split('@')[0],
      role: 'admin', twoFactorEnabled: false, organizationId: org.id, createdAt: now, updatedAt: now,
    }]);
    if (uErr) { console.warn(`⚠ FAIL ${email} — ${uErr.message}`); continue; }
    const { error: pErr } = await sb.from('PortalUser').insert([{
      id: uuidv4(), userId, shopId: shop.id, position: 'shop_owner', isActive: true,
      mobileAccess: true, organizationId: org.id, createdAt: now, updatedAt: now,
    }]);
    if (pErr) { console.warn(`⚠ FAIL ${email} PortalUser — ${pErr.message}`); continue; }
    added += 1;
    console.log(`✔ ${email}`);
  }

  console.log(`\nAdded ${added}/${emails.length} tester account(s) to "${ORG_SLUG}".`);
  console.log(`Fallback password for all: ${FALLBACK_PASSWORD}`);
  console.log('These emails should also be on the Play closed-testing tester list (Google Group) so they can install.');
}

main().catch((e) => { console.error('add-test-tenant-users failed:', e); process.exit(1); });
