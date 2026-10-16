// Provisions a "showcase" tenant used ONLY to capture Play Store / marketing
// screenshots: realistic products, ~30 days of sales (mixed Cash / M-Pesa /
// Card, some split, some discounted) and operating expenses, so the dashboard,
// analytics and lists look like a real shop. Kept separate from the closed-
// testing "testers" tenant so screenshot data never mixes with tester data.
//
// Re-runnable: pass --reset to delete the previous showcase data first.
// Product photos (CC0) are uploaded from --images <dir> (<key>.jpg each).
// Usage: SHOWCASE_PASSWORD=... npx tsx scripts/seed-showcase-tenant.ts [--reset] [--images <dir>]

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

const ORG_NAME = 'Amani Fashion House';
const ORG_SLUG = 'showcase';
const SHOP_NAME = 'Amani Fashion — Westlands';
const OWNER_EMAIL = 'royaltrack.showcase@mailinator.com';
const OWNER_NAME = 'Wanjiku Kamau';
// The demo owner's password comes from the environment, never the repo (it is public).
const OWNER_PASSWORD = process.env.SHOWCASE_PASSWORD ?? '';
if (OWNER_PASSWORD.length < 8) {
  console.error('Set SHOWCASE_PASSWORD (8+ characters) to the demo owner password.');
  process.exit(1);
}

// name, category, price, costPrice, opening qty, lowStockThreshold, photo (<key>.jpg in --images dir)
const PRODUCTS: [string, string, number, number, number, number, string][] = [
  ['Floral Summer Dress',      'dresses',     2800, 1500,  55, 10, 'floral-dress'],
  ['Maxi Evening Gown',        'dresses',     5800, 3400,  30,  8, 'evening-gown'],
  ['Off-Shoulder Shirt Dress', 'dresses',     3200, 1800,  50, 10, 'shirt-dress'],
  ['Woven Leather Brogues',    'shoes',       4500, 2700,  40, 10, 'brogues'],
  ['White Leather Sneakers',   'shoes',       3200, 1800,  70, 15, 'sneakers'],
  ['Woven Beach Sandals',      'shoes',       1500,  800,  18, 15, 'sandals'],  // ends low-stock
  ['Classic Denim Jeans',      'trousers',    2600, 1450,  75, 12, 'jeans'],
  ['Linen Mandarin Shirt',     'shirts',      2200, 1200,  65, 12, 'linen-shirt'],
  ['Cotton Crew T-Shirt',      'shirts',       900,  450, 120, 20, 'tshirts'],
  ['Leather Tote Handbag',     'accessories', 4800, 2600,  14,  8, 'handbag'],  // ends low-stock
  ['Polarised Sunglasses',     'accessories', 1800,  900,  45, 10, 'sunglasses'],
  ['Brown Leather Belt',       'accessories', 1200,  600,  60, 12, 'belt'],
];

const CUSTOMERS = ['Achieng Otieno', 'Brian Mwangi', 'Fatuma Hassan', 'Kevin Kiprop', 'Grace Wambui', 'Mercy Njeri', null, null, null];
const PHONES = ['0712 345 678', '0723 456 789', '0734 567 890', '0745 678 901', '0756 789 012', '0798 123 456'];

// Deterministic PRNG so re-runs give the same-looking data.
let seed = 20261012;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  const sb = createClient(url, key);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const yearOut = new Date(nowMs + 365 * 86400000).toISOString();

  const { data: existingOrg } = await sb.from('Organization').select('id').eq('slug', ORG_SLUG).maybeSingle();
  if (existingOrg) {
    if (!process.argv.includes('--reset')) {
      console.error(`Organization "${ORG_SLUG}" already exists (id ${existingOrg.id}). Re-run with --reset to rebuild it.`);
      process.exit(1);
    }
    const orgId = existingOrg.id;
    const { data: files } = await sb.storage.from('products').list(`${orgId}/showcase`);
    if (files?.length) await sb.storage.from('products').remove(files.map((f) => `${orgId}/showcase/${f.name}`));
    // Children first (FKs), then the org itself.
    for (const t of ['SalesEntry', 'StockTransaction', 'ShopStock', 'Expense', 'ExpenseCategory', 'Product', 'PortalUser', 'TenantSubscription', 'Shop', 'User']) {
      const { error } = await sb.from(t).delete().eq('organizationId', orgId);
      if (error) console.warn(`⚠ reset ${t}: ${error.message}`);
    }
    const { error } = await sb.from('Organization').delete().eq('id', orgId);
    if (error) throw new Error(`reset Organization: ${error.message}`);
    console.log(`✔ Reset previous showcase org ${orgId}`);
  }

  const { data: org, error: orgErr } = await sb.from('Organization').insert([{
    name: ORG_NAME, slug: ORG_SLUG, status: 'active', planTier: 'free', currency: 'KES',
    tagline: 'Fashion & Lifestyle', trialEndsAt: yearOut, createdAt: now, updatedAt: now,
  }]).select('*').single();
  if (orgErr || !org) throw new Error(`Organization insert failed: ${orgErr?.message}`);
  const orgId = org.id as string;
  console.log(`✔ Organization  ${orgId}`);

  const { data: proPlan } = await sb.from('PlatformPlan').select('id').eq('tier', 'pro').maybeSingle();
  const { error: subErr } = await sb.from('TenantSubscription').insert([{
    organizationId: orgId, planId: proPlan?.id ?? null, status: 'trialing',
    trialStart: now, trialEnd: yearOut, createdAt: now, updatedAt: now,
  }]);
  if (subErr) console.warn(`⚠ TenantSubscription: ${subErr.message}`);

  const shopId = uuidv4();
  const { error: shopErr } = await sb.from('Shop').insert([{
    id: shopId, name: SHOP_NAME, location: 'Westlands, Nairobi', phone: '0712 000 111', isActive: true,
    organizationId: orgId, createdAt: now, updatedAt: now,
  }]);
  if (shopErr) throw new Error(`Shop insert failed: ${shopErr.message}`);

  const userId = uuidv4();
  const portalUserId = uuidv4();
  const { error: userErr } = await sb.from('User').insert([{
    id: userId, email: OWNER_EMAIL, password: await bcrypt.hash(OWNER_PASSWORD, 10),
    name: OWNER_NAME, role: 'admin', twoFactorEnabled: false,
    organizationId: orgId, createdAt: now, updatedAt: now,
  }]);
  if (userErr) throw new Error(`User insert failed: ${userErr.message}`);
  const { error: puErr } = await sb.from('PortalUser').insert([{
    id: portalUserId, userId, shopId, position: 'shop_owner', isActive: true,
    mobileAccess: true, organizationId: orgId, createdAt: now, updatedAt: now,
  }]);
  if (puErr) throw new Error(`PortalUser insert failed: ${puErr.message}`);

  // Products: opening stock dated 35 days back; sales below draw it down.
  const opened = new Date(nowMs - 35 * 86400000).toISOString();
  const imagesArg = process.argv.indexOf('--images');
  const imagesDir = imagesArg > -1 ? process.argv[imagesArg + 1] : null;
  const products = await Promise.all(PRODUCTS.map(async ([name, category, price, costPrice, qty, low, photo], i) => {
    const images: string[] = [];
    const file = imagesDir ? resolve(imagesDir, `${photo}.jpg`) : null;
    if (file && existsSync(file)) {
      const path = `${orgId}/showcase/${photo}.jpg`;
      const { error } = await sb.storage.from('products').upload(path, readFileSync(file), { contentType: 'image/jpeg', upsert: true });
      if (error) console.warn(`⚠ photo ${photo}: ${error.message}`);
      else images.push(sb.storage.from('products').getPublicUrl(path).data.publicUrl);
    }
    return { id: uuidv4(), name, category, price, costPrice, qty, low, images, sku: `AMF-${String(i + 1).padStart(3, '0')}` };
  }));
  const { error: pErr } = await sb.from('Product').insert(products.map((p) => ({
    id: p.id, organizationId: orgId, name: p.name, description: `${p.name} — Amani Fashion House`,
    price: p.price, costPrice: p.costPrice, category: p.category, images: p.images, sizes: [], colors: [],
    stockQuantity: p.qty, sku: p.sku, featured: false, trending: false, createdAt: opened, updatedAt: now,
  })));
  if (pErr) throw new Error(`Product insert failed: ${pErr.message}`);

  // Sales: 30 days, busier on weekends, trending up slightly.
  const remaining = new Map(products.map((p) => [p.id, p.qty]));
  const sales: Record<string, unknown>[] = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(nowMs - d * 86400000);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const groups = d === 0 ? 9 : Math.round((weekend ? 6 : 3) + rand() * 3 + (29 - d) / 10);
    for (let g = 0; g < groups; g++) {
      const at = new Date(day);
      at.setHours(9 + Math.floor(rand() * 10), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      // Today: spread from opening (09:00) up to a few minutes ago.
      if (d === 0) {
        const open = new Date(day).setHours(9, 0, 0, 0);
        at.setTime(open + rand() * Math.max(0, nowMs - 5 * 60000 - open));
      }
      const ts = at.toISOString();
      const groupId = uuidv4();
      const lines = rand() < 0.3 ? 2 : 1;
      const r = rand();
      const method = r < 0.55 ? 'M-Pesa' : r < 0.85 ? 'Cash' : r < 0.93 ? 'Card' : 'Cash + M-Pesa';
      const customer = pick(CUSTOMERS);
      const discounted = rand() < 0.12;
      const used = new Set<string>();
      const groupStart = sales.length;
      for (let l = 0; l < lines; l++) {
        let p = pick(products);
        if (used.has(p.id)) p = products[(products.indexOf(p) + 1) % products.length];
        used.add(p.id);
        const left = remaining.get(p.id)!;
        const quantity = Math.min(rand() < 0.8 ? 1 : 2, Math.max(0, left - Math.ceil(p.low * 0.5)));
        if (quantity <= 0) continue;
        remaining.set(p.id, left - quantity);
        const gross = quantity * p.price;
        const discountAmount = discounted ? Math.round(gross * 0.1 / 50) * 50 : 0;
        const total = gross - discountAmount;
        sales.push({
          id: uuidv4(), organizationId: orgId, shopId, portalUserId, productId: p.id,
          quantity, unitPrice: p.price, totalAmount: total, costPrice: p.costPrice,
          paymentMethod: method,
          discountAmount, paymentBreakdown: null as unknown,
          customerName: customer, customerPhone: customer ? pick(PHONES) : null,
          entryDate: ts, createdAt: ts, updatedAt: ts, saleGroupId: groupId,
          currency: 'KES', exchangeRate: 1, baseAmount: total,
        });
      }
      // A split's breakdown is checkout-level: the same parts on every line.
      if (method === 'Cash + M-Pesa' && sales.length > groupStart) {
        const groupTotal = sales.slice(groupStart).reduce((s, x) => s + (x.totalAmount as number), 0);
        const cash = Math.round(groupTotal * 0.4 / 100) * 100;
        const paymentBreakdown = [{ method: 'Cash', amount: cash }, { method: 'M-Pesa', amount: groupTotal - cash }];
        for (const x of sales.slice(groupStart)) x.paymentBreakdown = paymentBreakdown;
      }
    }
  }
  for (let i = 0; i < sales.length; i += 200) {
    const { error } = await sb.from('SalesEntry').insert(sales.slice(i, i + 200));
    if (error) throw new Error(`SalesEntry insert failed: ${error.message}`);
  }
  console.log(`✔ ${sales.length} sale lines`);

  const { error: ssErr } = await sb.from('ShopStock').insert(products.map((p) => ({
    id: uuidv4(), organizationId: orgId, shopId, productId: p.id,
    quantity: remaining.get(p.id), lowStockThreshold: p.low, createdAt: opened, updatedAt: now,
  })));
  if (ssErr) throw new Error(`ShopStock insert failed: ${ssErr.message}`);
  for (const p of products) {
    await sb.from('Product').update({ stockQuantity: remaining.get(p.id) }).eq('id', p.id);
  }
  console.log(`✔ Stock: ${products.map((p) => `${p.sku}=${remaining.get(p.id)}`).join(' ')}`);

  // Expenses.
  const cats = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Marketing'].map((name) => ({ id: uuidv4(), name }));
  const { error: cErr } = await sb.from('ExpenseCategory').insert(cats.map((c) => ({
    id: c.id, organizationId: orgId, name: c.name, isActive: true, createdAt: now, updatedAt: now,
  })));
  if (cErr) console.warn(`⚠ ExpenseCategory: ${cErr.message}`);
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const dateAgo = (d: number) => new Date(nowMs - d * 86400000).toISOString().slice(0, 10);
  const expenses: [string, number, string, number][] = [
    ['Rent', 45000, 'October shop rent', 11],
    ['Salaries', 36000, 'Shop assistant salaries', 12],
    ['Utilities', 4200, 'KPLC electricity tokens', 9],
    ['Utilities', 3000, 'Safaricom Home Fibre', 8],
    ['Transport', 1800, 'Stock pickup — Gikomba', 6],
    ['Marketing', 5000, 'Instagram promotion', 4],
    ['Transport', 1200, 'Boda deliveries', 2],
  ];
  const { error: eErr } = await sb.from('Expense').insert(expenses.map(([c, amount, description, d]) => ({
    id: uuidv4(), organizationId: orgId, shopId, categoryId: cat(c), amount, currency: 'KES', exchangeRate: 1,
    baseAmount: amount, description, expenseDate: dateAgo(d), recordedBy: userId,
  })));
  if (eErr) console.warn(`⚠ Expense: ${eErr.message}`);
  else console.log(`✔ ${expenses.length} expenses`);

  console.log(`\n=== DONE ===\nLogin: ${OWNER_EMAIL} (password from SHOWCASE_PASSWORD)`);
}

main().catch((e) => { console.error('seed-showcase-tenant failed:', e); process.exit(1); });
