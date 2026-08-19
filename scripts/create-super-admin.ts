// Bootstraps (or updates) the platform-level super_admin user — a
// cross-tenant role with organizationId = null (see the CHECK constraint in
// supabase/migrations/20260818_05_set_organization_id_not_null.sql).
// Idempotent: safe to re-run (upserts by email).
//
// Usage: npm run admin:create
// Reads SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD / SUPER_ADMIN_NAME from env
// (.env.local or .env in the project root, or already-exported shell vars).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

function loadEnvFile(filename: string) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  const contents = readFileSync(path, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

async function main() {
  const email = process.env.SUPER_ADMIN_EMAIL;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME || 'Platform Admin';

  if (!email || !password) {
    console.error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set (in .env.local or the environment).');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('SUPER_ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    process.exit(1);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey);
  const normalizedEmail = email.toLowerCase();
  const now = new Date().toISOString();
  const hashedPassword = await bcrypt.hash(password, 10);

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('User')
    .select('id')
    .eq('email', normalizedEmail)
    .is('organizationId', null)
    .maybeSingle();

  if (lookupError) {
    console.error('Failed to look up existing super_admin:', lookupError.message);
    process.exit(1);
  }

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from('User')
      .update({ password: hashedPassword, name, role: 'super_admin', updatedAt: now })
      .eq('id', existing.id);
    if (updateError) {
      console.error('Failed to update super_admin:', updateError.message);
      process.exit(1);
    }
    console.log(`Updated existing super_admin (${normalizedEmail}).`);
    return;
  }

  const { error: insertError } = await supabaseAdmin.from('User').insert([{
    id: uuidv4(),
    email: normalizedEmail,
    password: hashedPassword,
    name,
    role: 'super_admin',
    organizationId: null,
    twoFactorEnabled: false,
    createdAt: now,
    updatedAt: now,
  }]);

  if (insertError) {
    console.error('Failed to create super_admin:', insertError.message);
    process.exit(1);
  }

  console.log(`Created super_admin (${normalizedEmail}).`);
}

main().catch((err) => {
  console.error('create-super-admin failed:', err);
  process.exit(1);
});
