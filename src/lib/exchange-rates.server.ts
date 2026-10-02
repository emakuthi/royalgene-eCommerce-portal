import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { fetchLatestRates } from './frankfurter.server';
import logger from './logger';
import type { Currency, ExchangeRate } from './types';

const GLOBAL_BASE = 'KES'; // we sync everything relative to the base currency
const GLOBAL_ID = '00000000-0000-0000-0000-000000000000'; // "global" scope sentinel (matches the migration default)

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Currencies ────────────────────────────────────────────────────────────────
export async function getCurrencies(): Promise<Currency[]> {
  const { data } = await supabaseAdmin.from('Currency').select('*').order('isBase', { ascending: false }).order('code');
  return (data as Currency[]) ?? [];
}

export async function getActiveCurrencies(): Promise<Currency[]> {
  const { data } = await supabaseAdmin.from('Currency').select('*').eq('isActive', true).order('isBase', { ascending: false }).order('code');
  return (data as Currency[]) ?? [];
}

// ── Rate resolution ───────────────────────────────────────────────────────────
/**
 * The applicable rate row for base→target on (or before) `date`: a tenant
 * override wins over the global Frankfurter rate. Returns null if none exists.
 */
async function getRateRow(base: string, target: string, date: string, organizationId?: string | null): Promise<ExchangeRate | null> {
  const b = base.toUpperCase();
  const t = target.toUpperCase();
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from('ExchangeRate')
      .select('*')
      .eq('organizationId', organizationId)
      .eq('baseCurrency', b)
      .eq('targetCurrency', t)
      .lte('rateDate', date)
      .order('rateDate', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as ExchangeRate;
  }
  const { data: global } = await supabaseAdmin
    .from('ExchangeRate')
    .select('*')
    .eq('organizationId', GLOBAL_ID)
    .eq('baseCurrency', b)
    .eq('targetCurrency', t)
    .lte('rateDate', date)
    .order('rateDate', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (global as ExchangeRate) ?? null;
}

/**
 * Numeric base→target rate, triangulated through the global base ({@link GLOBAL_BASE})
 * when a direct pair isn't stored. Returns null if it can't be resolved.
 */
export async function getRate(base: string, target: string, opts: { date?: string; organizationId?: string | null } = {}): Promise<number | null> {
  const b = base.toUpperCase();
  const t = target.toUpperCase();
  if (b === t) return 1;
  const date = opts.date || today();
  const org = opts.organizationId ?? null;

  const direct = await getRateRow(b, t, date, org);
  if (direct) return direct.rate;

  const inverse = await getRateRow(t, b, date, org);
  if (inverse && inverse.rate > 0) return 1 / inverse.rate;

  // Triangulate via the global base: rate(b→t) = rate(base→t) / rate(base→b),
  // using the stored base→X rows (base→X = "how many X per 1 base").
  const baseToTarget = t === GLOBAL_BASE ? 1 : (await getRateRow(GLOBAL_BASE, t, date, org))?.rate ?? null;
  const baseToSource = b === GLOBAL_BASE ? 1 : (await getRateRow(GLOBAL_BASE, b, date, org))?.rate ?? null;
  if (baseToTarget != null && baseToSource != null && baseToSource > 0) {
    return baseToTarget / baseToSource;
  }
  return null;
}

/** Latest rate per pair for the admin UI — global rows plus this tenant's overrides. */
export async function listRates(organizationId?: string | null): Promise<ExchangeRate[]> {
  const { data: globals } = await supabaseAdmin
    .from('ExchangeRate')
    .select('*')
    .eq('organizationId', GLOBAL_ID)
    .order('rateDate', { ascending: false });
  let overrides: ExchangeRate[] = [];
  if (organizationId) {
    const { data } = await supabaseAdmin
      .from('ExchangeRate')
      .select('*')
      .eq('organizationId', organizationId)
      .order('rateDate', { ascending: false });
    overrides = (data as ExchangeRate[]) ?? [];
  }
  // Keep only the newest row per (scope,pair)
  const latest = new Map<string, ExchangeRate>();
  for (const r of [...((globals as ExchangeRate[]) ?? []), ...overrides]) {
    const key = `${r.organizationId ?? 'global'}:${r.baseCurrency}:${r.targetCurrency}`;
    if (!latest.has(key)) latest.set(key, r);
  }
  return [...latest.values()];
}

// ── Sync from Frankfurter (global rows only) ──────────────────────────────────
/**
 * Fetch today's rates for every active currency (relative to the base) and
 * append global rows. Never overwrites a tenant override (those carry an
 * organizationId and live in separate rows). On API failure it leaves the
 * existing rates untouched and returns { ok: false }.
 */
export async function syncFromFrankfurter(): Promise<{ ok: boolean; count: number; date?: string; error?: string }> {
  const currencies = await getActiveCurrencies();
  const targets = currencies.map((c) => c.code).filter((c) => c.toUpperCase() !== GLOBAL_BASE);
  if (targets.length === 0) return { ok: true, count: 0 };

  const fx = await fetchLatestRates(GLOBAL_BASE, targets);
  if (!fx) return { ok: false, count: 0, error: 'Frankfurter unavailable' };

  const rows = Object.entries(fx.rates).map(([target, rate]) => ({
    organizationId: GLOBAL_ID,
    baseCurrency: GLOBAL_BASE,
    targetCurrency: target,
    rate,
    rateDate: fx.date,
    source: 'FRANKFURTER',
    manuallyOverridden: false,
  }));
  if (rows.length === 0) return { ok: true, count: 0, date: fx.date };

  // One row per (global, pair, day): upsert on the unique scope/pair/date index.
  const { error } = await supabaseAdmin
    .from('ExchangeRate')
    .upsert(rows, { onConflict: 'organizationId,baseCurrency,targetCurrency,rateDate', ignoreDuplicates: false });
  if (error) {
    logger.warn('Exchange-rate sync upsert failed', { error: error.message });
    return { ok: false, count: 0, error: error.message };
  }
  return { ok: true, count: rows.length, date: fx.date };
}

// ── Manual overrides (per tenant) ─────────────────────────────────────────────
export async function setManualOverride(
  organizationId: string,
  base: string,
  target: string,
  rate: number,
  userId?: string | null,
): Promise<ExchangeRate | null> {
  const row = {
    organizationId,
    baseCurrency: base.toUpperCase(),
    targetCurrency: target.toUpperCase(),
    rate,
    rateDate: today(),
    source: 'MANUAL',
    manuallyOverridden: true,
    createdBy: userId ?? null,
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin
    .from('ExchangeRate')
    .upsert([row], { onConflict: 'organizationId,baseCurrency,targetCurrency,rateDate', ignoreDuplicates: false })
    .select('*')
    .maybeSingle();
  if (error) {
    logger.warn('Manual override upsert failed', { error: error.message });
    return null;
  }
  return (data as ExchangeRate) ?? null;
}

export async function updateOverride(id: string, organizationId: string, rate: number, userId?: string | null): Promise<ExchangeRate | null> {
  const { data, error } = await supabaseAdmin
    .from('ExchangeRate')
    .update({ rate, source: 'MANUAL', manuallyOverridden: true, createdBy: userId ?? null, updatedAt: new Date().toISOString() })
    .eq('id', id)
    .eq('organizationId', organizationId) // tenant isolation: can only edit own overrides
    .select('*')
    .maybeSingle();
  if (error) {
    logger.warn('Override update failed', { error: error.message });
    return null;
  }
  return (data as ExchangeRate) ?? null;
}
