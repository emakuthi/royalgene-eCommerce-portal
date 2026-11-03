import { describe, it, expect, vi, beforeEach } from 'vitest';

let rows: Array<{ userId: string; isActive: boolean }> = [];
let failWith: 'error' | 'throw' | null = null;
const fromMock = vi.fn();

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      fromMock(table);
      return {
        select: () => ({
          eq: async (_col: string, userId: string) => {
            if (failWith === 'throw') throw new Error('network');
            if (failWith === 'error') return { data: null, error: { message: 'down' } };
            return { data: rows.filter((r) => r.userId === userId), error: null };
          },
        }),
      };
    },
  },
}));

import { isDeactivatedStaff, rejectIfDeactivated } from '@/lib/deactivated-staff.server';

const staff = { userId: 'u1', role: 'portal_user' };

beforeEach(() => {
  rows = [];
  failWith = null;
  fromMock.mockClear();
});

describe('isDeactivatedStaff', () => {
  it('is true once every shop row is inactive', async () => {
    rows = [{ userId: 'u1', isActive: false }, { userId: 'u1', isActive: false }];
    expect(await isDeactivatedStaff(staff)).toBe(true);
  });

  it('is false while any shop row is still active', async () => {
    rows = [{ userId: 'u1', isActive: false }, { userId: 'u1', isActive: true }];
    expect(await isDeactivatedStaff(staff)).toBe(false);
  });

  it('is false with no rows, which the mobile access gate handles', async () => {
    expect(await isDeactivatedStaff(staff)).toBe(false);
  });

  it('never locks out a workspace admin, without even looking', async () => {
    rows = [{ userId: 'u1', isActive: false }];
    expect(await isDeactivatedStaff({ userId: 'u1', role: 'admin' })).toBe(false);
    expect(await isDeactivatedStaff({ userId: 'u1', role: 'super_admin' })).toBe(false);
    expect(fromMock).not.toHaveBeenCalled();
  });

  it.each(['error', 'throw'] as const)('lets people in when the lookup fails (%s)', async (mode) => {
    rows = [{ userId: 'u1', isActive: false }];
    failWith = mode;
    expect(await isDeactivatedStaff(staff)).toBe(false);
  });
});

describe('rejectIfDeactivated', () => {
  it('answers 401 with its own code and a reason', async () => {
    rows = [{ userId: 'u1', isActive: false }];
    const response = await rejectIfDeactivated(staff);
    expect(response?.status).toBe(401);
    const body = await response?.json();
    expect(body.code).toBe('ACCOUNT_DEACTIVATED');
    expect(body.error).toContain('deactivated');
  });

  it('lets active staff through', async () => {
    rows = [{ userId: 'u1', isActive: true }];
    expect(await rejectIfDeactivated(staff)).toBeNull();
  });
});
