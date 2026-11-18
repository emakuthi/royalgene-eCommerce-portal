import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

// One ShopStock row. `interfere` lets a test change it between the read and
// the guarded write, the way another sale or transfer landing would.
const row = { quantity: 5 as number };
let interfere: (() => void) | null = null;

function chain() {
  let update: Record<string, unknown> | null = null;
  const eqs: Record<string, unknown> = {};
  const obj: Record<string, unknown> = {};
  obj.select = vi.fn(() => (update ? done() : obj));
  obj.eq = vi.fn((c: string, v: unknown) => { eqs[c] = v; return obj; });
  obj.update = vi.fn((u: Record<string, unknown>) => { update = u; return obj; });
  obj.maybeSingle = vi.fn(async () => {
    const data = { quantity: row.quantity };
    if (interfere) { interfere(); interfere = null; }
    return { data };
  });
  function done() {
    if (eqs.quantity !== row.quantity) return Promise.resolve({ data: [] });
    row.quantity = update!.quantity as number;
    return Promise.resolve({ data: [{ id: 'ss-1' }] });
  }
  return obj;
}
vi.mock('../supabase-client', () => ({ supabaseAdmin: { from: vi.fn(() => chain()) } }));

import { adjustShopStock } from '../shop-stock.server';

beforeEach(() => { row.quantity = 5; interfere = null; });

describe('adjustShopStock', () => {
  it('keeps both changes when another one lands between read and write', async () => {
    interfere = () => { row.quantity = 3; }; // a transfer holds 2 meanwhile
    const r = await adjustShopStock('ss-1', -1, 'allow');
    expect(r).toEqual({ ok: true, before: 3, after: 2 });
    expect(row.quantity).toBe(2);
  });

  it('refuses to go below zero when asked', async () => {
    expect(await adjustShopStock('ss-1', -6, 'refuse')).toEqual({ ok: false, available: 5 });
    expect(row.quantity).toBe(5);
  });

  it('clamps or allows below zero', async () => {
    expect(await adjustShopStock('ss-1', -6, 'clamp')).toMatchObject({ ok: true, after: 0 });
    row.quantity = 1;
    expect(await adjustShopStock('ss-1', -2, 'allow')).toMatchObject({ ok: true, after: -1 });
  });

  it('keeps decimal quantities exact', async () => {
    row.quantity = 0.3;
    expect(await adjustShopStock('ss-1', -0.1, 'refuse')).toMatchObject({ ok: true, after: 0.2 });
  });
});
