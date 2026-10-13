import { describe, it, expect, vi, beforeEach } from 'vitest';

// Shop managers, shopkeepers and cashiers see (and change) only the expenses
// they recorded; owner-level callers see every expense.

vi.mock('server-only', () => ({}));
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock('../currency.server', () => ({ getOrgCurrency: vi.fn(async () => ({ currency: 'KES' })) }));
vi.mock('../exchange-rates.server', () => ({ getRate: vi.fn(async () => 1) }));
const owner = { value: false };
vi.mock('../permissions.server', () => ({ isOwnerLevelCaller: vi.fn(async () => owner.value) }));

const calls: [string, unknown][] = [];
const result = { rows: [] as Record<string, unknown>[] };
function chain() {
  const obj: Record<string, unknown> = {};
  for (const m of ['select', 'is', 'gte', 'lte', 'order', 'limit', 'update', 'in']) obj[m] = vi.fn(() => obj);
  obj.eq = vi.fn((col: string, val: unknown) => { calls.push([col, val]); return obj; });
  obj.then = (f: (v: unknown) => unknown) => Promise.resolve({ data: result.rows, error: null }).then(f);
  return obj;
}
vi.mock('../supabase-client', () => ({ supabaseAdmin: { from: vi.fn(() => chain()) } }));

import { expenseScopeFor, listExpenses, deleteExpense } from '../expenses.server';

beforeEach(() => { calls.length = 0; result.rows = []; owner.value = false; });

describe('expense visibility', () => {
  it('scopes staff to their own expenses', async () => {
    expect(await expenseScopeFor({ userId: 'u-cashier', role: 'portal_user' })).toBe('u-cashier');
  });

  it('lets owner-level callers see everyone\'s', async () => {
    owner.value = true;
    expect(await expenseScopeFor({ userId: 'u-owner', role: 'portal_user' })).toBeNull();
  });

  it('filters the list by recorder when scoped', async () => {
    await listExpenses('org-1', { recordedBy: 'u-cashier' });
    expect(calls).toContainEqual(['recordedBy', 'u-cashier']);
  });

  it('does not filter the list for an owner', async () => {
    await listExpenses('org-1', { recordedBy: null });
    expect(calls.map(([c]) => c)).not.toContain('recordedBy');
  });

  it("reports failure when staff try to delete someone else's expense", async () => {
    result.rows = []; // the recordedBy filter matched nothing
    expect(await deleteExpense('exp-1', 'org-1', 'u-cashier')).toBe(false);
    expect(calls).toContainEqual(['recordedBy', 'u-cashier']);
  });

  it('deletes their own', async () => {
    result.rows = [{ id: 'exp-1' }];
    expect(await deleteExpense('exp-1', 'org-1', 'u-cashier')).toBe(true);
  });
});
