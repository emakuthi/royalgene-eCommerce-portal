import { vi } from 'vitest';

export interface MockTables {
  [table: string]: Record<string, unknown>[];
}

/**
 * A minimal stand-in for supabaseAdmin's chainable query builder, scoped to
 * what entitlement-service.server.ts / subscription-status.server.ts
 * actually call: select/eq/gte/in/order/limit, .maybeSingle()/.single(), and
 * being awaited directly (used for count queries and inserts).
 */
export function createSupabaseMock(tables: MockTables) {
  function makeBuilder(table: string) {
    let rows = [...(tables[table] ?? [])];

    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      }),
      gte: vi.fn((col: string, val: unknown) => {
        rows = rows.filter((r) => (r[col] as string) >= (val as string));
        return builder;
      }),
      in: vi.fn((col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      insert: vi.fn((newRows: Record<string, unknown>[]) => {
        rows = newRows;
        tables[table] = [...(tables[table] ?? []), ...newRows];
        return builder;
      }),
      update: vi.fn((patch: Record<string, unknown>) => {
        rows = rows.map((r) => ({ ...r, ...patch }));
        return builder;
      }),
      upsert: vi.fn((newRows: Record<string, unknown>[]) => {
        rows = newRows;
        return builder;
      }),
      maybeSingle: vi.fn(async () => ({ data: rows[0] ?? null, error: null })),
      single: vi.fn(async () => ({ data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } })),
      then: (resolve: (v: { data: unknown[]; count: number; error: null }) => void) => {
        resolve({ data: rows, count: rows.length, error: null });
      },
    };
    return builder;
  }

  return { from: vi.fn((table: string) => makeBuilder(table)) };
}
