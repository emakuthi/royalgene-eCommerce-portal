import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const sendEmail = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('@/lib/email/password-reset-email', () => ({
  sendPasswordResetEmail: (...a: unknown[]) => sendEmail(...a),
}));
vi.mock('@/lib/auth.server', () => ({ hashPassword: async (p: string) => `hashed:${p}` }));

// Tiny in-memory stand-in for the two tables this module touches.
type Row = Record<string, unknown>;
let users: Row[] = [];
let codes: Row[] = [];

function table(name: string) {
  const store = name === 'User' ? users : codes;
  const state: { rows: Row[]; single: boolean } = { rows: [...store], single: false };
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: unknown) => { state.rows = state.rows.filter((r) => r[col] === val); return api; },
    is: (col: string, val: unknown) => { state.rows = state.rows.filter((r) => (r[col] ?? null) === val); return api; },
    gte: (col: string, val: string) => { state.rows = state.rows.filter((r) => String(r[col]) >= val); return api; },
    order: () => { state.rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); return api; },
    limit: (n: number) => { state.rows = state.rows.slice(0, n); return api; },
    maybeSingle: async () => ({ data: state.rows[0] ?? null, error: null }),
    then: (res: (v: { data: Row[]; error: null }) => void) => res({ data: state.rows, error: null }),
    insert: async (newRows: Row[]) => { store.push(...newRows.map((r) => ({ id: `id-${store.length}`, ...r }))); return { error: null }; },
    update: (patch: Row) => ({
      eq: (col: string, val: unknown) => ({
        is: (c2: string, v2: unknown) => {
          store.forEach((r) => { if (r[col] === val && (r[c2] ?? null) === v2) Object.assign(r, patch); });
          return Promise.resolve({ error: null });
        },
        then: (res: (v: { error: null }) => void) => {
          store.forEach((r) => { if (r[col] === val) Object.assign(r, patch); });
          res({ error: null });
        },
      }),
    }),
  };
  return api;
}

vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

import { requestPasswordReset, resetPasswordWithCode } from '@/lib/password-reset.server';

const hash = (c: string) => createHash('sha256').update(c).digest('hex');

beforeEach(() => {
  users = [{ id: 'user-1', email: 'jane@acme.io', name: 'Jane' }];
  codes = [];
});
afterEach(() => { vi.clearAllMocks(); });

describe('requestPasswordReset', () => {
  it('stores a hashed code and emails it for a known address', async () => {
    await requestPasswordReset('  Jane@Acme.io ');
    expect(codes).toHaveLength(1);
    expect(codes[0].codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(codes[0].consumedAt).toBeUndefined();
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('sends at most one code a minute', async () => {
    codes.push({ id: 'c0', userId: 'user-1', createdAt: new Date(Date.now() - 20_000).toISOString() });
    await requestPasswordReset('jane@acme.io');
    expect(codes).toHaveLength(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('stops after 3 codes in a day, and allows one again once the oldest is a day old', async () => {
    const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
    codes.push(
      { id: 'c1', userId: 'user-1', createdAt: ago(1) },
      { id: 'c2', userId: 'user-1', createdAt: ago(5) },
      { id: 'c3', userId: 'user-1', createdAt: ago(23) },
    );
    await requestPasswordReset('jane@acme.io');
    expect(sendEmail).not.toHaveBeenCalled();

    codes[2].createdAt = ago(25);
    await requestPasswordReset('jane@acme.io');
    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it('is a silent no-op for an unknown address', async () => {
    await requestPasswordReset('nobody@nowhere.io');
    expect(codes).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('resetPasswordWithCode', () => {
  beforeEach(() => {
    codes = [{
      id: 'c1', userId: 'user-1', codeHash: hash('123456'),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), consumedAt: null, attempts: 0,
      createdAt: new Date().toISOString(),
    }];
  });

  it('rejects a short password', async () => {
    const r = await resetPasswordWithCode('jane@acme.io', '123456', 'short');
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects a wrong code and bumps attempts', async () => {
    const r = await resetPasswordWithCode('jane@acme.io', '000000', 'longenough1');
    expect(r).toMatchObject({ ok: false, code: 'INVALID_CODE' });
    expect(codes[0].attempts).toBe(1);
  });

  it('rejects an expired code', async () => {
    codes[0].expiresAt = new Date(Date.now() - 1000).toISOString();
    const r = await resetPasswordWithCode('jane@acme.io', '123456', 'longenough1');
    expect(r).toMatchObject({ ok: false });
  });

  it('sets the password and consumes the code on success', async () => {
    const r = await resetPasswordWithCode('jane@acme.io', '123456', 'longenough1');
    expect(r).toEqual({ ok: true });
    expect(users[0].password).toBe('hashed:longenough1');
    expect(users[0].passwordChangedAt).toBeTruthy();
    expect(codes[0].consumedAt).toBeTruthy();
  });

  it('locks out after 5 attempts', async () => {
    codes[0].attempts = 5;
    const r = await resetPasswordWithCode('jane@acme.io', '123456', 'longenough1');
    expect(r).toMatchObject({ ok: false, status: 429 });
  });
});
