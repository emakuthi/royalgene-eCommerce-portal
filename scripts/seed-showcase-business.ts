// Provisions a supermarket or restaurant "showcase" tenant used ONLY to capture
// Play Store / marketing screenshots of the business-type features: products
// sold by kg / litre with fractional sales (supermarket), or menu items with
// recipes that use up ingredient stock (restaurant). ~30 days of sales and some
// expenses so the dashboard and lists look like a real business.
// Companion to seed-showcase-tenant.ts (the boutique).
//
// Re-runnable: pass --reset to delete the previous data for that profile first.
// Product photos (CC0) are uploaded from --images <dir> (<key>.jpg each).
// Usage: SHOWCASE_PASSWORD=... npx tsx scripts/seed-showcase-business.ts --profile supermarket|restaurant [--reset] [--images <dir>]

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { categorySlug, getBusinessType, isMeasuredUnit, roundQuantity, type BusinessTypeId } from '../src/lib/business-types';

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

interface ProductDef {
  key: string; // also the photo file name
  name: string;
  category: string; // display name; slugged
  unit: string;
  price: number;
  cost: number;
  qty: number; // opening stock (ignored for menu items)
  low: number;
  kind?: 'stock' | 'menu';
  /** menu items: ingredient key -> amount per one item */
  recipe?: Record<string, number>;
  /** relative sales weight */
  weight?: number;
}

interface Profile {
  type: BusinessTypeId;
  slug: string;
  orgName: string;
  tagline: string;
  shopName: string;
  location: string;
  ownerEmail: string;
  ownerName: string;
  skuPrefix: string;
  products: ProductDef[];
  expenses: [string, number, string, number][];
  groupsPerDay: [number, number]; // weekday, weekend base
}

const PROFILES: Record<'supermarket' | 'restaurant', Profile> = {
  supermarket: {
    type: 'supermarket',
    slug: 'showcase-mart',
    orgName: 'Baraka Mini Mart',
    tagline: 'Groceries & Fresh Produce',
    shopName: 'Baraka Mini Mart — Kilimani',
    location: 'Kilimani, Nairobi',
    ownerEmail: 'royaltrack.mart@mailinator.com',
    ownerName: 'Joseph Mutua',
    skuPrefix: 'BMM',
    groupsPerDay: [9, 14],
    products: [
      { key: 'rice', name: 'Pishori Rice', category: 'Food & groceries', unit: 'kg', price: 220, cost: 160, qty: 420, low: 15, weight: 3 },
      { key: 'sugar', name: 'White Sugar', category: 'Food & groceries', unit: 'kg', price: 180, cost: 140, qty: 330, low: 15, weight: 3 },
      { key: 'tomatoes', name: 'Fresh Tomatoes', category: 'Fresh produce', unit: 'kg', price: 120, cost: 70, qty: 240, low: 10, weight: 3 },
      { key: 'onions', name: 'Red Onions', category: 'Fresh produce', unit: 'kg', price: 100, cost: 60, qty: 190, low: 10, weight: 2 },
      { key: 'bananas', name: 'Sweet Bananas', category: 'Fresh produce', unit: 'kg', price: 90, cost: 50, qty: 130, low: 12, weight: 2 }, // ends low
      { key: 'milk', name: 'Fresh Milk 500ml', category: 'Dairy', unit: 'piece', price: 65, cost: 52, qty: 520, low: 24, weight: 4 },
      { key: 'bread', name: 'White Bread 400g', category: 'Bakery', unit: 'piece', price: 70, cost: 55, qty: 470, low: 20, weight: 4 },
      { key: 'oil', name: 'Sunflower Cooking Oil', category: 'Food & groceries', unit: 'litre', price: 360, cost: 290, qty: 200, low: 10, weight: 2 },
      { key: 'eggs', name: 'Eggs (tray of 30)', category: 'Dairy', unit: 'piece', price: 450, cost: 380, qty: 40, low: 8, weight: 1 }, // ends low
    ],
    expenses: [
      ['Rent', 60000, 'Shop rent', 11],
      ['Salaries', 48000, 'Cashier & stock staff', 12],
      ['Utilities', 6800, 'KPLC electricity tokens', 9],
      ['Transport', 3500, 'Market pickup — Marikiti', 5],
      ['Supplies', 2400, 'Carrier bags & receipt rolls', 3],
    ],
  },
  restaurant: {
    type: 'restaurant',
    slug: 'showcase-cafe',
    orgName: 'Kahawa Grill & Café',
    tagline: 'Grill · Burgers · Coffee',
    shopName: 'Kahawa Grill — Lavington',
    location: 'Lavington, Nairobi',
    ownerEmail: 'royaltrack.cafe@mailinator.com',
    ownerName: 'Amina Odhiambo',
    skuPrefix: 'KGC',
    groupsPerDay: [14, 22],
    products: [
      // Ingredients (stocked)
      { key: 'beef', name: 'Beef', category: 'Ingredients', unit: 'kg', price: 750, cost: 650, qty: 190, low: 5 },
      { key: 'chicken', name: 'Chicken', category: 'Ingredients', unit: 'kg', price: 600, cost: 480, qty: 130, low: 5 },
      { key: 'potatoes', name: 'Potatoes', category: 'Ingredients', unit: 'kg', price: 120, cost: 80, qty: 330, low: 10 },
      { key: 'buns', name: 'Burger Buns', category: 'Ingredients', unit: 'piece', price: 30, cost: 20, qty: 420, low: 30 },
      { key: 'cheese', name: 'Cheese Slices', category: 'Ingredients', unit: 'piece', price: 25, cost: 18, qty: 330, low: 30 },
      // Sold straight from stock
      { key: 'soda', name: 'Soda 500ml', category: 'Drinks', unit: 'bottle', price: 100, cost: 60, qty: 460, low: 24, weight: 4 },
      // Menu items (made to order)
      { key: 'burger', name: 'Classic Beef Burger', category: 'Main course', unit: 'plate', price: 650, cost: 0, qty: 0, low: 0, kind: 'menu', weight: 5, recipe: { buns: 1, beef: 0.15, cheese: 1 } },
      { key: 'chicken-chips', name: 'Chicken & Chips', category: 'Main course', unit: 'plate', price: 750, cost: 0, qty: 0, low: 0, kind: 'menu', weight: 4, recipe: { chicken: 0.25, potatoes: 0.3 } },
      { key: 'nyama', name: 'Nyama Choma (½ kg)', category: 'Main course', unit: 'plate', price: 900, cost: 0, qty: 0, low: 0, kind: 'menu', weight: 3, recipe: { beef: 0.5 } },
      { key: 'chips', name: 'Masala Chips', category: 'Sides', unit: 'plate', price: 300, cost: 0, qty: 0, low: 0, kind: 'menu', weight: 4, recipe: { potatoes: 0.4 } },
    ],
    expenses: [
      ['Rent', 85000, 'Restaurant rent', 11],
      ['Salaries', 96000, 'Chefs & waiters', 12],
      ['Utilities', 14500, 'Gas refill & electricity', 8],
      ['Supplies', 6200, 'Takeaway boxes & napkins', 4],
      ['Transport', 2800, 'Butcher & market deliveries', 2],
    ],
  },
};

// The demo owner's password comes from the environment, never the repo (it is public).
const OWNER_PASSWORD = process.env.SHOWCASE_PASSWORD ?? '';
if (OWNER_PASSWORD.length < 8) {
  console.error('Set SHOWCASE_PASSWORD (8+ characters) to the demo owner password.');
  process.exit(1);
}
const CUSTOMERS = ['Achieng Otieno', 'Brian Mwangi', 'Fatuma Hassan', 'Kevin Kiprop', 'Grace Wambui', null, null, null, null, null];

let seed = 20261016;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
function weighted<T extends { weight?: number }>(xs: T[]): T {
  const total = xs.reduce((s, x) => s + (x.weight ?? 1), 0);
  let r = rand() * total;
  for (const x of xs) { r -= x.weight ?? 1; if (r <= 0) return x; }
  return xs[xs.length - 1];
}

async function main() {
  const profArg = process.argv.indexOf('--profile');
  const profName = profArg > -1 ? process.argv[profArg + 1] : '';
  if (profName !== 'supermarket' && profName !== 'restaurant') throw new Error('--profile supermarket|restaurant is required');
  const P = PROFILES[profName];
  const typeDef = getBusinessType(P.type);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  const sb = createClient(url, key);
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const yearOut = new Date(nowMs + 365 * 86400000).toISOString();

  const { data: existingOrg } = await sb.from('Organization').select('id').eq('slug', P.slug).maybeSingle();
  if (existingOrg) {
    if (!process.argv.includes('--reset')) {
      console.error(`Organization "${P.slug}" already exists (id ${existingOrg.id}). Re-run with --reset to rebuild it.`);
      process.exit(1);
    }
    const orgId = existingOrg.id;
    const { data: files } = await sb.storage.from('products').list(`${orgId}/showcase`);
    if (files?.length) await sb.storage.from('products').remove(files.map((f) => `${orgId}/showcase/${f.name}`));
    for (const t of ['SalesEntry', 'StockTransaction', 'RecipeItem', 'ShopStock', 'Expense', 'ExpenseCategory', 'Product', 'ProductCategory', 'PortalUser', 'TenantSubscription', 'Shop', 'User']) {
      const { error } = await sb.from(t).delete().eq('organizationId', orgId);
      if (error) console.warn(`⚠ reset ${t}: ${error.message}`);
    }
    const { error } = await sb.from('Organization').delete().eq('id', orgId);
    if (error) throw new Error(`reset Organization: ${error.message}`);
    console.log(`✔ Reset previous ${P.slug} org ${orgId}`);
  }

  const { data: org, error: orgErr } = await sb.from('Organization').insert([{
    name: P.orgName, slug: P.slug, status: 'active', planTier: 'free', currency: 'KES', tagline: P.tagline,
    businessType: typeDef.id, option1Label: typeDef.option1Label, option2Label: typeDef.option2Label,
    trialEndsAt: yearOut, createdAt: now, updatedAt: now,
  }]).select('*').single();
  if (orgErr || !org) throw new Error(`Organization insert failed: ${orgErr?.message}`);
  const orgId = org.id as string;
  console.log(`✔ Organization ${P.orgName} ${orgId}`);

  const { data: proPlan } = await sb.from('PlatformPlan').select('id').eq('tier', 'pro').maybeSingle();
  const { error: subErr } = await sb.from('TenantSubscription').insert([{
    organizationId: orgId, planId: proPlan?.id ?? null, status: 'trialing',
    trialStart: now, trialEnd: yearOut, createdAt: now, updatedAt: now,
  }]);
  if (subErr) console.warn(`⚠ TenantSubscription: ${subErr.message}`);

  // The type's starter categories (plus any a product uses).
  const catNames = [...new Set([...typeDef.categories, ...P.products.map((p) => p.category)])];
  const { error: pcErr } = await sb.from('ProductCategory').insert(catNames.map((name, i) => ({
    organizationId: orgId, slug: categorySlug(name), name, sortOrder: i + 1,
  })));
  if (pcErr) console.warn(`⚠ ProductCategory: ${pcErr.message}`);

  const shopId = uuidv4();
  const { error: shopErr } = await sb.from('Shop').insert([{
    id: shopId, name: P.shopName, location: P.location, phone: '0712 000 222', isActive: true,
    organizationId: orgId, createdAt: now, updatedAt: now,
  }]);
  if (shopErr) throw new Error(`Shop insert failed: ${shopErr.message}`);

  const userId = uuidv4();
  const portalUserId = uuidv4();
  const { error: userErr } = await sb.from('User').insert([{
    id: userId, email: P.ownerEmail, password: await bcrypt.hash(OWNER_PASSWORD, 10),
    name: P.ownerName, role: 'admin', twoFactorEnabled: false, emailVerifiedAt: now,
    organizationId: orgId, createdAt: now, updatedAt: now,
  }]);
  if (userErr) throw new Error(`User insert failed: ${userErr.message}`);
  const { error: puErr } = await sb.from('PortalUser').insert([{
    id: portalUserId, userId, shopId, position: 'shop_owner', isActive: true,
    mobileAccess: true, organizationId: orgId, createdAt: now, updatedAt: now,
  }]);
  if (puErr) throw new Error(`PortalUser insert failed: ${puErr.message}`);

  // Menu items cost what their recipe costs.
  const byKey = new Map(P.products.map((p) => [p.key, p]));
  for (const p of P.products) {
    if (p.kind === 'menu' && p.recipe) {
      p.cost = Math.round(Object.entries(p.recipe).reduce((s, [k, q]) => s + byKey.get(k)!.cost * q, 0));
    }
  }

  const opened = new Date(nowMs - 35 * 86400000).toISOString();
  const imagesArg = process.argv.indexOf('--images');
  const imagesDir = imagesArg > -1 ? process.argv[imagesArg + 1] : null;
  const products = await Promise.all(P.products.map(async (def, i) => {
    const images: string[] = [];
    const file = imagesDir ? resolve(imagesDir, `${def.key}.jpg`) : null;
    if (file && existsSync(file)) {
      const path = `${orgId}/showcase/${def.key}.jpg`;
      const { error } = await sb.storage.from('products').upload(path, readFileSync(file), { contentType: 'image/jpeg', upsert: true });
      if (error) console.warn(`⚠ photo ${def.key}: ${error.message}`);
      else images.push(sb.storage.from('products').getPublicUrl(path).data.publicUrl);
    }
    return { ...def, id: uuidv4(), images, sku: `${P.skuPrefix}-${String(i + 1).padStart(3, '0')}` };
  }));
  const idOf = new Map(products.map((p) => [p.key, p.id]));
  const { error: pErr } = await sb.from('Product').insert(products.map((p) => ({
    id: p.id, organizationId: orgId, name: p.name, description: `${p.name} — ${P.orgName}`,
    price: p.price, costPrice: p.cost, category: categorySlug(p.category), unit: p.unit, kind: p.kind ?? 'stock',
    images: p.images, sizes: [], colors: [], stockQuantity: p.kind === 'menu' ? 0 : p.qty, sku: p.sku,
    featured: false, trending: false, createdAt: opened, updatedAt: now,
  })));
  if (pErr) throw new Error(`Product insert failed: ${pErr.message}`);

  const recipes = products.filter((p) => p.kind === 'menu' && p.recipe).flatMap((p) =>
    Object.entries(p.recipe!).map(([k, q]) => ({ organizationId: orgId, productId: p.id, ingredientProductId: idOf.get(k)!, quantity: q })));
  if (recipes.length) {
    const { error } = await sb.from('RecipeItem').insert(recipes);
    if (error) throw new Error(`RecipeItem insert failed: ${error.message}`);
    console.log(`✔ ${recipes.length} recipe lines`);
  }

  // Sales: 30 days, busier on weekends, trending up slightly.
  const sellable = products.filter((p) => (p.weight ?? 0) > 0);
  const remaining = new Map(products.map((p) => [p.id, p.qty]));
  const sales: Record<string, unknown>[] = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(nowMs - d * 86400000);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const [wd, we] = P.groupsPerDay;
    const groups = d === 0 ? Math.round(wd * 0.8) : Math.round((weekend ? we : wd) * (0.75 + rand() * 0.5) + (29 - d) / 8);
    for (let g = 0; g < groups; g++) {
      const at = new Date(day);
      at.setHours(8 + Math.floor(rand() * 12), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      if (d === 0) {
        const open = new Date(day).setHours(8, 0, 0, 0);
        at.setTime(open + rand() * Math.max(0, nowMs - 5 * 60000 - open));
      }
      const ts = at.toISOString();
      const groupId = uuidv4();
      const lines = rand() < 0.45 ? 2 : rand() < 0.2 ? 3 : 1;
      const r = rand();
      const method = r < 0.6 ? 'M-Pesa' : r < 0.9 ? 'Cash' : 'Card';
      const customer = CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)];
      const used = new Set<string>();
      for (let l = 0; l < lines; l++) {
        const p = weighted(sellable);
        if (used.has(p.id)) continue;
        used.add(p.id);
        let quantity = isMeasuredUnit(p.unit) ? [0.5, 1, 1, 1.5, 2, 2.5][Math.floor(rand() * 6)] : rand() < 0.75 ? 1 : 2;
        if (p.kind === 'menu') {
          // Use up ingredients; skip the line if the kitchen would run dry.
          const needs = Object.entries(p.recipe ?? {}).map(([k, q]) => [idOf.get(k)!, q * quantity] as const);
          const ok = needs.every(([id, n]) => remaining.get(id)! - n >= byKey.get(products.find((x) => x.id === id)!.key)!.low * 0.6);
          if (!ok) continue;
          for (const [id, n] of needs) remaining.set(id, roundQuantity(remaining.get(id)! - n));
        } else {
          const left = remaining.get(p.id)!;
          quantity = Math.min(quantity, Math.max(0, roundQuantity(left - p.low * 0.6)));
          if (!isMeasuredUnit(p.unit)) quantity = Math.floor(quantity);
          if (quantity <= 0) continue;
          remaining.set(p.id, roundQuantity(left - quantity));
        }
        const total = Math.round(quantity * p.price);
        sales.push({
          id: uuidv4(), organizationId: orgId, shopId, portalUserId, productId: p.id,
          quantity, unitPrice: p.price, totalAmount: total, costPrice: p.cost,
          paymentMethod: method, discountAmount: 0, paymentBreakdown: null,
          customerName: customer, customerPhone: null,
          entryDate: ts, createdAt: ts, updatedAt: ts, saleGroupId: groupId,
          currency: 'KES', exchangeRate: 1, baseAmount: total,
        });
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
    quantity: p.kind === 'menu' ? 0 : remaining.get(p.id), lowStockThreshold: p.low, createdAt: opened, updatedAt: now,
  })));
  if (ssErr) throw new Error(`ShopStock insert failed: ${ssErr.message}`);
  for (const p of products) {
    if (p.kind !== 'menu') await sb.from('Product').update({ stockQuantity: remaining.get(p.id) }).eq('id', p.id);
  }
  console.log(`✔ Stock: ${products.filter((p) => p.kind !== 'menu').map((p) => `${p.key}=${remaining.get(p.id)}${p.unit === 'piece' ? '' : p.unit}`).join(' ')}`);

  const catList = [...new Set(P.expenses.map((e) => e[0]))].map((name) => ({ id: uuidv4(), name }));
  const { error: cErr } = await sb.from('ExpenseCategory').insert(catList.map((c) => ({
    id: c.id, organizationId: orgId, name: c.name, isActive: true, createdAt: now, updatedAt: now,
  })));
  if (cErr) console.warn(`⚠ ExpenseCategory: ${cErr.message}`);
  const dateAgo = (d: number) => new Date(nowMs - d * 86400000).toISOString().slice(0, 10);
  const { error: eErr } = await sb.from('Expense').insert(P.expenses.map(([c, amount, description, d]) => ({
    id: uuidv4(), organizationId: orgId, shopId, categoryId: catList.find((x) => x.name === c)!.id, amount,
    currency: 'KES', exchangeRate: 1, baseAmount: amount, description, expenseDate: dateAgo(d), recordedBy: userId,
  })));
  if (eErr) console.warn(`⚠ Expense: ${eErr.message}`);
  else console.log(`✔ ${P.expenses.length} expenses`);

  console.log(`\n=== DONE ===\nLogin: ${P.ownerEmail} (password from SHOWCASE_PASSWORD)`);
}

main().catch((e) => { console.error('seed-showcase-business failed:', e); process.exit(1); });
