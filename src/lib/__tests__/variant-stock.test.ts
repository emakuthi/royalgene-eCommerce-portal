import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * In-memory ShopStockVariant table behind a chainable stub that mimics the
 * PostgREST builder surface variant-stock.server.ts actually uses.
 */
type Row = { id: string; shopStockId: string; organizationId: string | null; size: string; color: string; quantity: number; updatedAt?: string };
let table: Row[] = [];

function makeQuery(op: 'select' | 'delete' | 'update', patch?: Record<string, unknown>, headCountInit = false) {
  const filters: Array<(r: Row) => boolean> = [];
  let gteQty: number | null = null;
  let headCount = headCountInit;

  const q = {
    eq(col: string, val: unknown) { filters.push((r) => (r as Record<string, unknown>)[col] === val); return q; },
    in(col: string, vals: unknown[]) { filters.push((r) => vals.includes((r as Record<string, unknown>)[col])); return q; },
    gte(col: string, val: number) { if (col === 'quantity') gteQty = val; return q; },
    order() { return q; },
    select(_cols?: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) headCount = true; return q; },
    then(resolve: (v: unknown) => void) {
      const matched = table.filter((r) => filters.every((f) => f(r)));
      if (op === 'delete') {
        table = table.filter((r) => !matched.includes(r));
        return resolve({ data: null, error: null });
      }
      if (op === 'update') {
        const eligible = gteQty === null ? matched : matched.filter((r) => r.quantity >= gteQty!);
        for (const r of eligible) Object.assign(r, patch);
        return resolve({ data: eligible.map((r) => ({ ...r })), error: null });
      }
      if (headCount) return resolve({ count: matched.length, error: null });
      return resolve({ data: matched.map((r) => ({ ...r })), error: null });
    },
    async maybeSingle() {
      const matched = table.filter((r) => filters.every((f) => f(r)));
      const eligible = op === 'update' && gteQty !== null ? matched.filter((r) => r.quantity >= gteQty!) : matched;
      if (op === 'update') { for (const r of eligible) Object.assign(r, patch); }
      return { data: eligible[0] ? { ...eligible[0] } : null, error: null };
    },
  };
  return q;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from(name: string) {
      if (name !== 'ShopStockVariant') throw new Error(`unexpected table ${name}`);
      return {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => makeQuery('select', undefined, opts?.head ?? false),
        delete: () => makeQuery('delete'),
        update: (patch: Record<string, unknown>) => makeQuery('update', patch),
        insert: async (rows: Row[]) => { table.push(...rows.map((r) => ({ ...r }))); return { data: rows, error: null }; },
        upsert: async (rows: Row[]) => {
          for (const r of rows) {
            const i = table.findIndex((x) => x.id === r.id);
            if (i >= 0) table[i] = { ...table[i], ...r };
            else table.push({ ...r });
          }
          return { data: rows, error: null };
        },
      };
    },
  },
}));

import { getVariantMatrix, setVariantMatrix, decrementCell, validateVariantRemoval, hasVariantStock } from '@/lib/variant-stock.server';

const SS = 'ss-1';
beforeEach(() => { table = []; });
afterEach(() => { vi.clearAllMocks(); });

async function seed(cells: Array<[string, string, number]>) {
  await setVariantMatrix(SS, 'org-1', cells.map(([size, color, quantity]) => ({ size, color, quantity })));
}

describe('getVariantMatrix', () => {
  it('rolls up row and column totals', async () => {
    await seed([['S', 'Red', 2], ['S', 'Blue', 1], ['M', 'Red', 3], ['M', 'Blue', 4]]);
    const m = await getVariantMatrix(SS);
    expect(m.total).toBe(10);
    expect(m.sizeTotals).toEqual({ S: 3, M: 7 });
    expect(m.colorTotals).toEqual({ Red: 5, Blue: 5 });
    expect(m.hasVariants).toBe(true);
  });

  it('is empty for a shopStock with no cells', async () => {
    const m = await getVariantMatrix(SS);
    expect(m).toMatchObject({ hasVariants: false, total: 0, cells: [] });
  });
});

describe('setVariantMatrix', () => {
  it('adds, updates and deletes cells to match the new set', async () => {
    await seed([['S', 'Red', 2], ['M', 'Red', 3]]);
    await setVariantMatrix(SS, 'org-1', [
      { size: 'S', color: 'Red', quantity: 5 },   // update
      { size: 'L', color: 'Red', quantity: 1 },    // add
    ]);                                            // M/Red dropped
    const m = await getVariantMatrix(SS);
    expect(m.total).toBe(6);
    expect(m.cells.map((c) => `${c.size}/${c.color}=${c.quantity}`).sort()).toEqual(['L/Red=1', 'S/Red=5']);
  });
});

describe('decrementCell', () => {
  it('takes stock off the exact cell', async () => {
    await seed([['M', 'Red', 3]]);
    const r = await decrementCell(SS, 'M', 'Red', 2);
    expect(r).toEqual({ ok: true, remaining: 1 });
    expect((await getVariantMatrix(SS)).total).toBe(1);
  });

  it('refuses when the cell is short', async () => {
    await seed([['M', 'Red', 1]]);
    const r = await decrementCell(SS, 'M', 'Red', 2);
    expect(r).toMatchObject({ ok: false, available: 1 });
  });

  it('refuses an unknown cell', async () => {
    await seed([['M', 'Red', 3]]);
    const r = await decrementCell(SS, 'M', 'Green', 1);
    expect(r).toMatchObject({ ok: false, available: 0 });
  });
});

describe('validateVariantRemoval', () => {
  it('is a no-op when the product has no breakdown', async () => {
    expect(await validateVariantRemoval(SS, undefined, undefined, 1)).toEqual({ needsVariant: false });
  });

  it('requires size + colour and enough in the cell', async () => {
    await seed([['S', 'Red', 2]]);
    expect(await validateVariantRemoval(SS, '', '', 1)).toMatchObject({ needsVariant: true, error: 'Select a size' });
    expect(await validateVariantRemoval(SS, 'S', '', 1)).toMatchObject({ needsVariant: true, error: 'Select a colour' });
    expect(await validateVariantRemoval(SS, 'S', 'Red', 5)).toMatchObject({ needsVariant: true, error: expect.stringMatching(/Only 2/) });
    expect(await validateVariantRemoval(SS, 'S', 'Red', 2)).toEqual({ needsVariant: true, error: null });
  });
});

describe('hasVariantStock', () => {
  it('reflects whether any cells exist', async () => {
    expect(await hasVariantStock(SS)).toBe(false);
    await seed([['S', 'Red', 1]]);
    expect(await hasVariantStock(SS)).toBe(true);
  });
});
