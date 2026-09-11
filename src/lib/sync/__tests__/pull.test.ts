import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
let tables: Record<string, Row[]> = {};

// A tiny query builder that understands exactly what pullChanges emits:
// select('*').eq(col,val).order(...).order(...).limit(n) and, optionally,
// .or('a.gt.X,and(a.eq.X,b.gt.Y)').
function evalCond(row: Row, cond: string): boolean {
  const andMatch = cond.match(/^and\((.+)\)$/);
  if (andMatch) return andMatch[1].split(',').every((c) => evalCond(row, c));
  const [col, op, ...rest] = cond.split('.');
  const val = rest.join('.');
  const rowVal = row[col];
  if (op === 'gt') return String(rowVal) > val;
  if (op === 'eq') return String(rowVal) === val;
  return false;
}

function makeTable(name: string) {
  let rows = [...(tables[name] ?? [])];
  const state: { orClause?: string; limit?: number } = {};
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => { rows = rows.filter((r) => r[col] === val); return api; },
    order: () => api,
    limit: (n: number) => { state.limit = n; return api; },
    or: (clause: string) => { state.orClause = clause; return api; },
    then: (resolve: (v: { data: Row[]; error: null }) => void) => {
      if (state.orClause) {
        // top-level split on ',' outside of and(...)
        const parts: string[] = [];
        let depth = 0, cur = '';
        for (const ch of state.orClause) {
          if (ch === '(') depth++;
          if (ch === ')') depth--;
          if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
        }
        if (cur) parts.push(cur);
        rows = rows.filter((r) => parts.some((p) => evalCond(r, p)));
      }
      rows.sort((a, b) => (String(a.updatedAt) + String(a.id)).localeCompare(String(b.updatedAt) + String(b.id)));
      if (state.limit) rows = rows.slice(0, state.limit);
      resolve({ data: rows, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: { from: (n: string) => makeTable(n) } }));

import { decodeCursor, encodeCursor, pullChanges } from '@/lib/sync/pull.server';

beforeEach(() => {
  tables = {
    Product: [
      { id: 'p1', organizationId: 'org-1', updatedAt: '2026-09-10T10:00:00.000Z', version: 1, deletedAt: null, name: 'A' },
      { id: 'p2', organizationId: 'org-1', updatedAt: '2026-09-10T10:00:01.000Z', version: 2, deletedAt: null, name: 'B' },
      { id: 'p3', organizationId: 'org-1', updatedAt: '2026-09-10T10:00:02.000Z', version: 1, deletedAt: '2026-09-10T10:00:02.000Z', name: 'C' },
      { id: 'other-org', organizationId: 'org-2', updatedAt: '2026-09-10T10:00:03.000Z', version: 1, deletedAt: null, name: 'X' },
    ],
    Shop: [
      { id: 's1', organizationId: 'org-1', updatedAt: '2026-09-10T09:00:00.000Z', version: 1, deletedAt: null, name: 'Shop 1' },
    ],
  };
});
afterEach(() => vi.clearAllMocks());

describe('cursor encode/decode', () => {
  it('round-trips', () => {
    const c = { Product: { updatedAt: '2026-09-10T10:00:01.000Z', id: 'p2' } };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });

  it('decodes null / garbage as empty', () => {
    expect(decodeCursor(null)).toEqual({});
    expect(decodeCursor('not-base64-json')).toEqual({});
  });
});

describe('pullChanges', () => {
  it('a first pull (no cursor) returns every row for the org, never another tenant\'s', async () => {
    const r = await pullChanges({ organizationId: 'org-1', cursor: {}, entities: ['Product'] });
    expect(r.changes.map((c) => c.id).sort()).toEqual(['p1', 'p2', 'p3']);
    expect(r.changes.some((c) => c.id === 'other-org')).toBe(false);
  });

  it('marks a soft-deleted row as DELETE with no data', async () => {
    const r = await pullChanges({ organizationId: 'org-1', cursor: {}, entities: ['Product'] });
    const del = r.changes.find((c) => c.id === 'p3')!;
    expect(del.operation).toBe('DELETE');
    expect(del.data).toBeNull();
  });

  it('a second pull with the returned cursor only sees newer rows', async () => {
    const first = await pullChanges({ organizationId: 'org-1', cursor: {}, entities: ['Product'], pageSize: 2 });
    expect(first.changes.map((c) => c.id)).toEqual(['p1', 'p2']);
    expect(first.hasMore).toBe(true);

    const second = await pullChanges({ organizationId: 'org-1', cursor: first.cursor, entities: ['Product'], pageSize: 2 });
    expect(second.changes.map((c) => c.id)).toEqual(['p3']);
    expect(second.hasMore).toBe(false);
  });

  it('pulls multiple entities independently and advances each cursor', async () => {
    const r = await pullChanges({ organizationId: 'org-1', cursor: {}, entities: ['Product', 'Shop'] });
    expect(r.cursor.Product).toBeDefined();
    expect(r.cursor.Shop).toEqual({ updatedAt: '2026-09-10T09:00:00.000Z', id: 's1' });
  });
});
