import { afterEach, describe, expect, it, vi } from 'vitest';

/** In-memory Supabase stand-in that models a PK-unique table. */
let rows: Array<Record<string, unknown>> = [];
let insertError: { code?: string; message: string } | null = null;

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from() {
      const state: { filter?: (r: Record<string, unknown>) => boolean } = {};
      const api: Record<string, unknown> = {
        insert: (newRows: Array<Record<string, unknown>>) => {
          const row = newRows[0];
          if (insertError) return api; // error path set below
          if (rows.some((r) => r.id === row.id)) {
            insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
            return api;
          }
          rows.push(row);
          state.filter = (r) => r.id === row.id;
          return api;
        },
        select: () => api,
        eq: (col: string, val: unknown) => { state.filter = (r) => r[col] === val; return api; },
        single: async () => {
          if (insertError) { const e = insertError; insertError = null; return { data: null, error: e }; }
          return { data: rows.find(state.filter ?? (() => false)) ?? null, error: null };
        },
        maybeSingle: async () => ({ data: rows.find(state.filter ?? (() => false)) ?? null, error: null }),
      };
      return api;
    },
  },
}));

import { idempotentInsert } from '@/lib/sync/idempotent-insert.server';
import { isValidClientId } from '@/lib/sync/syncable-entities';

afterEach(() => { rows = []; insertError = null; vi.clearAllMocks(); });

describe('isValidClientId', () => {
  it('accepts a v4 uuid, rejects anything else', () => {
    expect(isValidClientId('9c2a5ba3-0993-4237-a754-7ae4f1b3dafa')).toBe(true);
    expect(isValidClientId('not-a-uuid')).toBe(false);
    expect(isValidClientId(123)).toBe(false);
    expect(isValidClientId(undefined)).toBe(false);
  });
});

describe('idempotentInsert', () => {
  const id = '9c2a5ba3-0993-4237-a754-7ae4f1b3dafa';

  it('creates a new row', async () => {
    const r = await idempotentInsert('SalesEntry', { id, total: 100 });
    expect(r).toMatchObject({ ok: true, created: true });
    expect(rows).toHaveLength(1);
  });

  it('is a no-op replay on the same id — returns created:false and the existing row', async () => {
    await idempotentInsert('SalesEntry', { id, total: 100 });
    const r = await idempotentInsert('SalesEntry', { id, total: 999 });
    expect(r).toMatchObject({ ok: true, created: false });
    if (r.ok) expect((r.row as { total: number }).total).toBe(100); // original wins
    expect(rows).toHaveLength(1);
  });

  it('surfaces a non-PK unique violation as an error', async () => {
    insertError = { code: '23505', message: 'Shop_name_key' }; // not a PK hit — no row with this id
    const r = await idempotentInsert('Shop', { id: 'x0000000-0000-0000-0000-000000000000', name: 'Dup' });
    expect(r).toMatchObject({ ok: false, code: '23505' });
  });
});
