// Provisions the closed-testing sandbox tenant: one Organization, a long
// (1-year) Professional trial subscription so it never trial-locks mid-test,
// ONE Shop (so every user in this tenant only ever sees that shop), a
// caretaker owner login (for setup/verification), and ~10 demo products with
// stock. Per-tester Gmail accounts are added SEPARATELY (see
// scripts/add-test-tenant-user.ts) once the tester list is known, because
// Google social-login matches an existing User by email — pre-creating each
// tester's real Gmail here is what lands them in THIS shared shop instead of
// auto-provisioning them a brand-new workspace.
//
// Idempotent-ish: aborts if the slug already exists.
// Usage: npx tsx scripts/seed-test-tenant.ts

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
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

const ORG_NAME = 'RoyalTrack Testers';
const ORG_SLUG = 'testers';
const SHOP_NAME = 'RoyalTrack Demo Shop';
const CARETAKER_EMAIL = 'royaltrack.sandbox@mailinator.com';
const CARETAKER_NAME = 'Sandbox Owner';

// name, category, price(KES), costPrice(KES), qty, lowStockThreshold
const PRODUCTS: [string, string, number, number, number, number][] = [
  ['Ankara Print Dress',      'dresses',  2500, 1500, 40, 10],
  ['Maxi Evening Gown',       'dresses',  4500, 3000, 15, 10],
  ["Kids' Party Dress",       'dresses',  1500,  900, 35, 10],
  ["Men's Leather Loafers",   'shoes',    3800, 2400, 25, 10],
  ['Canvas Sneakers',         'shoes',    2200, 1300, 60, 15],
  ['Formal Oxford Shoes',     'shoes',    4200, 2800, 12, 15], // intentionally below threshold -> low-stock UI
  ['Slim-Fit Chinos',         'trousers', 1800, 1000, 50, 10],
  ['Denim Jeans',             'trousers', 2000, 1200, 45, 10],
  ['Cotton Bedsheet Set',     'textiles', 3200, 2000, 30, 10],
  ['Kitenge Fabric (per m)',  'textiles',  600,  350, 200, 20],
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  const sb = createClient(url, key);
  const now = new Date().toISOString();
  const yearOut = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  // Abort if slug already exists.
  const { data: existingOrg } = await sb.from('Organization').select('id').eq('slug', ORG_SLUG).maybeSingle();
  if (existingOrg) {
    console.error(`Organization slug "${ORG_SLUG}" already exists (id ${existingOrg.id}). Aborting to avoid duplicates.`);
    process.exit(1);
  }

  // 1) Organization — active, with a far-future trial so it never trial-locks during testing.
  const { data: org, error: orgErr } = await sb.from('Organization').insert([{
    name: ORG_NAME, slug: ORG_SLUG, status: 'active', planTier: 'free',
    trialEndsAt: yearOut, createdAt: now, updatedAt: now,
  }]).select('*').single();
  if (orgErr || !org) throw new Error(`Organization insert failed: ${orgErr?.message}`);
  console.log(`✔ Organization  ${org.id}  (slug: ${ORG_SLUG})`);

  // 2) Professional trial subscription (entitlements), 1-year window.
  const { data: proPlan } = await sb.from('PlatformPlan').select('id').eq('tier', 'pro').maybeSingle();
  const { error: subErr } = await sb.from('TenantSubscription').insert([{
    organizationId: org.id, planId: proPlan?.id ?? null, status: 'trialing',
    trialStart: now, trialEnd: yearOut, createdAt: now, updatedAt: now,
  }]);
  if (subErr) console.warn(`⚠ TenantSubscription insert failed (entitlements may cap): ${subErr.message}`);
  else console.log(`✔ TenantSubscription (pro trial, ends ${yearOut.slice(0, 10)})`);

  // 3) One Shop.
  const shopId = uuidv4();
  const { error: shopErr } = await sb.from('Shop').insert([{
    id: shopId, name: SHOP_NAME, location: 'Main', isActive: true,
    organizationId: org.id, createdAt: now, updatedAt: now,
  }]);
  if (shopErr) throw new Error(`Shop insert failed: ${shopErr.message}`);
  console.log(`✔ Shop          ${shopId}  ("${SHOP_NAME}")`);

  // 4) Caretaker owner login (for setup/verification — NOT a tester).
  const caretakerPassword = randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) + 'A1';
  const userId = uuidv4();
  const { error: userErr } = await sb.from('User').insert([{
    id: userId, email: CARETAKER_EMAIL.toLowerCase(), password: await bcrypt.hash(caretakerPassword, 10),
    name: CARETAKER_NAME, role: 'admin', twoFactorEnabled: false,
    organizationId: org.id, createdAt: now, updatedAt: now,
  }]);
  if (userErr) throw new Error(`Caretaker User insert failed: ${userErr.message}`);
  const { error: puErr } = await sb.from('PortalUser').insert([{
    id: uuidv4(), userId, shopId, position: 'shop_owner', isActive: true,
    mobileAccess: true, organizationId: org.id, createdAt: now, updatedAt: now,
  }]);
  if (puErr) throw new Error(`Caretaker PortalUser insert failed: ${puErr.message}`);
  console.log(`✔ Caretaker     ${CARETAKER_EMAIL}  /  ${caretakerPassword}`);

  // 5) Products + stock.
  let n = 0;
  for (const [name, category, price, costPrice, qty, low] of PRODUCTS) {
    const productId = uuidv4();
    n += 1;
    const sku = `TST-${String(n).padStart(3, '0')}`;
    const { error: pErr } = await sb.from('Product').insert([{
      id: productId, organizationId: org.id, name, description: `${name} — demo stock for testing`,
      price, costPrice, category, images: [], sizes: [], colors: [],
      stockQuantity: qty, sku, featured: false, trending: false, createdAt: now, updatedAt: now,
    }]);
    if (pErr) { console.warn(`⚠ Product "${name}" failed: ${pErr.message}`); continue; }
    const { error: sErr } = await sb.from('ShopStock').insert([{
      id: uuidv4(), organizationId: org.id, shopId, productId,
      quantity: qty, lowStockThreshold: low, createdAt: now, updatedAt: now,
    }]);
    if (sErr) { console.warn(`⚠ ShopStock for "${name}" failed: ${sErr.message}`); continue; }
    console.log(`  · ${sku}  ${name}  (KES ${price}, qty ${qty})`);
  }

  console.log('\n=== DONE ===');
  console.log(`Org:   ${ORG_NAME} (${ORG_SLUG})  id=${org.id}`);
  console.log(`Shop:  ${SHOP_NAME}  id=${shopId}`);
  console.log(`Owner: ${CARETAKER_EMAIL}  password above ^`);
  console.log('Next: add per-tester Gmail accounts so Google social-login lands them in THIS shop.');
}

main().catch((e) => { console.error('seed-test-tenant failed:', e); process.exit(1); });
