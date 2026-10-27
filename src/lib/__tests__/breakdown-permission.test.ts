import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const caps: Record<string, boolean> = {};
vi.mock('../permissions.server', () => ({ hasCapability: vi.fn(async (_p: unknown, c: string) => Boolean(caps[c])) }));

let cells: unknown[] = [];
vi.mock('../variant-stock.server', () => ({ getVariantMatrix: vi.fn(async () => ({ cells })) }));

let createdAt: string | null = null;
vi.mock('../supabase-client', () => ({
  supabaseAdmin: {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: createdAt ? { createdAt } : null });
      return q;
    },
  },
}));

import { canSetBreakdown } from '../breakdown-permission.server';

const payload = { userId: 'eva', role: 'portal_user', organizationId: 'org' } as never;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

beforeEach(() => {
  for (const k of Object.keys(caps)) delete caps[k];
  cells = [];
  createdAt = minutesAgo(1);
});

describe('canSetBreakdown', () => {
  it('edit inventory may always change the breakdown', async () => {
    caps.edit_inventory = true;
    cells = [{ size: 'M' }];
    createdAt = minutesAgo(60 * 24 * 30);
    expect(await canSetBreakdown(payload, 's1')).toBe(true);
  });

  it('add inventory may give a just-added product its first breakdown', async () => {
    caps.add_inventory = true;
    expect(await canSetBreakdown(payload, 's1')).toBe(true);
  });

  it('add inventory may not change a breakdown that already exists', async () => {
    caps.add_inventory = true;
    cells = [{ size: 'M' }];
    expect(await canSetBreakdown(payload, 's1')).toBe(false);
  });

  it('add inventory may not add a breakdown to an older product', async () => {
    caps.add_inventory = true;
    createdAt = minutesAgo(90);
    expect(await canSetBreakdown(payload, 's1')).toBe(false);
  });

  it('neither permission: refused', async () => {
    expect(await canSetBreakdown(payload, 's1')).toBe(false);
  });
});
