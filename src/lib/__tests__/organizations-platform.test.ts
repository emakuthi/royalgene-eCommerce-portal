import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable Supabase stub: every builder method returns `this`; the terminal
// awaitables (`maybeSingle`, and awaiting a `delete().eq()` chain) resolve to
// whatever the test set on `mock`.
const mock: { row: unknown; deleteError: { message: string } | null } = { row: null, deleteError: null };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['select', 'update', 'eq', 'is', 'not', 'order', 'insert', 'upsert', 'ilike', 'limit']) {
    builder[m] = vi.fn(chain);
  }
  builder.maybeSingle = vi.fn(async () => ({ data: mock.row, error: null }));
  builder.single = vi.fn(async () => ({ data: mock.row, error: null }));
  // `await supabaseAdmin.from('x').delete().eq('id', y)` — delete() returns a
  // thenable chain that resolves to { error }.
  builder.delete = vi.fn(() => {
    const del: Record<string, unknown> = {};
    del.eq = vi.fn(() => del);
    (del as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve({ error: mock.deleteError });
    return del;
  });
  return builder;
}

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: { from: vi.fn(() => makeBuilder()) },
}));

const removeCustomDomainMock = vi.fn(async (..._args: unknown[]) => ({ ok: true as const }));
vi.mock('@/lib/domains.server', () => ({
  removeCustomDomain: (...args: unknown[]) => removeCustomDomainMock(...args),
}));

import {
  DEFAULT_ORGANIZATION_ID,
  isDefaultOrganization,
  purgeOrganization,
  softDeleteOrganization,
  updateOrganizationDetails,
} from '@/lib/organizations.server';

beforeEach(() => {
  mock.row = null;
  mock.deleteError = null;
  removeCustomDomainMock.mockClear();
});

afterEach(() => { vi.clearAllMocks(); });

describe('isDefaultOrganization', () => {
  it('matches by fixed id or by DEV_TENANT_SLUG', () => {
    expect(isDefaultOrganization({ id: DEFAULT_ORGANIZATION_ID, slug: 'whatever' })).toBe(true);
    expect(isDefaultOrganization({ id: 'x', slug: 'royalgene' })).toBe(true);
    expect(isDefaultOrganization({ id: 'x', slug: 'acme' })).toBe(false);
  });
});

describe('softDeleteOrganization', () => {
  it('refuses the default tenant', async () => {
    mock.row = { id: DEFAULT_ORGANIZATION_ID, slug: 'royalgene' };
    await expect(softDeleteOrganization(DEFAULT_ORGANIZATION_ID)).rejects.toThrow(/default workspace/i);
    expect(removeCustomDomainMock).not.toHaveBeenCalled();
  });

  it('returns null for an unknown org', async () => {
    mock.row = null;
    expect(await softDeleteOrganization('nope')).toBeNull();
  });

  it('detaches the domain and marks the org cancelled + deletedAt', async () => {
    mock.row = { id: 'org-2', slug: 'acme', status: 'cancelled', deletedAt: '2026-08-29T00:00:00Z' };
    const result = await softDeleteOrganization('org-2');
    expect(removeCustomDomainMock).toHaveBeenCalledWith('org-2');
    expect(result).toMatchObject({ id: 'org-2', status: 'cancelled' });
  });
});

describe('purgeOrganization', () => {
  it('refuses when the org was never soft-deleted', async () => {
    mock.row = { id: 'org-2', slug: 'acme', deletedAt: null };
    expect(await purgeOrganization('org-2', 'acme')).toEqual({ ok: false, error: expect.stringMatching(/Soft-delete/) });
  });

  it('refuses a mismatched confirmation slug', async () => {
    mock.row = { id: 'org-2', slug: 'acme', deletedAt: '2026-08-29T00:00:00Z' };
    expect(await purgeOrganization('org-2', 'wrong')).toEqual({ ok: false, error: expect.stringMatching(/Confirmation/) });
  });

  it('refuses the default tenant even when marked deleted', async () => {
    mock.row = { id: DEFAULT_ORGANIZATION_ID, slug: 'royalgene', deletedAt: '2026-08-29T00:00:00Z' };
    expect(await purgeOrganization(DEFAULT_ORGANIZATION_ID, 'royalgene')).toEqual({
      ok: false,
      error: expect.stringMatching(/default workspace/i),
    });
  });

  it('deletes when soft-deleted and the slug matches', async () => {
    mock.row = { id: 'org-2', slug: 'acme', deletedAt: '2026-08-29T00:00:00Z' };
    expect(await purgeOrganization('org-2', 'acme')).toEqual({ ok: true });
  });

  it('surfaces a FK error (migration not run) as a helpful message', async () => {
    mock.row = { id: 'org-2', slug: 'acme', deletedAt: '2026-08-29T00:00:00Z' };
    mock.deleteError = { message: 'update or delete on table "Organization" violates foreign key constraint' };
    const res = await purgeOrganization('org-2', 'acme');
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toMatch(/20260829_01/);
  });
});

describe('updateOrganizationDetails', () => {
  it('rejects a too-short name', async () => {
    await expect(updateOrganizationDetails('org-2', { name: 'a' })).rejects.toThrow(/2–100/);
  });

  it('trims and saves a valid name', async () => {
    mock.row = { id: 'org-2', name: 'Acme Retail' };
    const result = await updateOrganizationDetails('org-2', { name: '  Acme Retail  ' });
    expect(result).toMatchObject({ id: 'org-2', name: 'Acme Retail' });
  });
});
