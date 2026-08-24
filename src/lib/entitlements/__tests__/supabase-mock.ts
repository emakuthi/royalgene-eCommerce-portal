import { vi } from 'vitest';

export interface MockTables {
  [table: string]: Record<string, unknown>[];
}

function isSameIdentity(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if ('organizationId' in b && 'integrationType' in b) {
    return a.organizationId === b.organizationId && a.integrationType === b.integrationType;
  }
  if ('planId' in b && 'code' in b) {
    return a.planId === b.planId && a.code === b.code;
  }
  return false;
}

/**
 * A minimal stand-in for supabaseAdmin's chainable query builder. Supports
 * select/eq/gte/in/order/limit filters, insert/update/upsert/delete writes
 * (persisted back into the shared `tables` object so a later .from() call in
 * the same test sees the effect), and both terminal-method
 * (.maybeSingle()/.single()) and direct-await (.then()) resolution styles,
 * matching how this app's *.server.ts modules actually call supabase-js.
 */
export function createSupabaseMock(tables: MockTables) {
  function makeBuilder(table: string) {
    let rows = [...(tables[table] ?? [])]; // same object references as tables[table]
    let mode: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let writePatch: Record<string, unknown> | null = null;
    let writeRows: Record<string, unknown>[] | null = null;
    let committed = false;

    function commit() {
      if (committed) return;
      committed = true;
      const current = tables[table] ?? [];

      if (mode === 'insert' && writeRows) {
        tables[table] = [...current, ...writeRows];
        rows = writeRows;
      } else if (mode === 'upsert' && writeRows) {
        const next = [...current];
        for (const newRow of writeRows) {
          const idx = next.findIndex((existing) => isSameIdentity(existing, newRow));
          if (idx >= 0) next[idx] = { ...next[idx], ...newRow };
          else next.push(newRow);
        }
        tables[table] = next;
        rows = writeRows;
      } else if (mode === 'update' && writePatch) {
        const matched = new Set(rows);
        tables[table] = current.map((r) => (matched.has(r) ? { ...r, ...writePatch } : r));
        rows = rows.map((r) => ({ ...r, ...writePatch }));
      } else if (mode === 'delete') {
        const matched = new Set(rows);
        tables[table] = current.filter((r) => !matched.has(r));
      }
    }

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
      is: vi.fn((col: string, val: null | boolean) => {
        rows = rows.filter((r) => (r[col] ?? null) === val);
        return builder;
      }),
      // Minimal support for the one shape this codebase actually uses:
      // "col.eq.value,col.is.null" (OR'd conditions, comma-separated,
      // dot-separated column/operator/value per condition) — not a general
      // Postgrest filter-string parser.
      or: vi.fn((filterString: string) => {
        const conditions = filterString.split(',').map((part) => {
          const [col, op, ...rest] = part.split('.');
          return { col, op, val: rest.join('.') };
        });
        rows = rows.filter((r) =>
          conditions.some(({ col, op, val }) => {
            if (op === 'is') return (r[col] ?? null) === (val === 'null' ? null : val);
            return String(r[col]) === val;
          }),
        );
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      insert: vi.fn((newRows: Record<string, unknown>[]) => {
        mode = 'insert';
        writeRows = newRows;
        return builder;
      }),
      update: vi.fn((patch: Record<string, unknown>) => {
        mode = 'update';
        writePatch = patch;
        return builder;
      }),
      upsert: vi.fn((newRows: Record<string, unknown>[]) => {
        mode = 'upsert';
        writeRows = newRows;
        return builder;
      }),
      delete: vi.fn(() => {
        mode = 'delete';
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        commit();
        return { data: rows[0] ?? null, error: null };
      }),
      single: vi.fn(async () => {
        commit();
        return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } };
      }),
      then: (resolve: (v: { data: unknown[]; count: number; error: null }) => void) => {
        commit();
        resolve({ data: rows, count: rows.length, error: null });
      },
    };
    return builder;
  }

  return { from: vi.fn((table: string) => makeBuilder(table)) };
}
