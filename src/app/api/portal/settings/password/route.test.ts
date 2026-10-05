import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockUser = { id: 'user-1', password: '$2a$10$abcdefg' };
const comparePasswordsMock = vi.fn(async (_plain: string, _hashed: string) => true);
const updateMock = vi.fn((_u: unknown) => ({ eq: vi.fn(() => ({ error: null })) }));

// The route authenticates via requireAuth (@/lib/authorize) and hashes via
// @/lib/auth.server — mock those (this test used to mock the retired @/lib/auth,
// so a real JWT check rejected the fake token and the test always failed).
vi.mock('@/lib/authorize', () => ({ requireAuth: vi.fn(() => ({ userId: 'user-1' })) }));
vi.mock('@/lib/auth.server', () => ({
  comparePasswords: (plain: string, hashed: string) => comparePasswordsMock(plain, hashed),
  hashPassword: async (_p: string) => 'hashed-new',
}));

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'User') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: mockUser, error: null })) })) })),
          update: (u: unknown) => updateMock(u),
        };
      }
      return {};
    }),
  },
}));

import { PUT } from './route';

function req(body: object) {
  return new Request('http://localhost/api/portal/settings/password', {
    method: 'PUT',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => { comparePasswordsMock.mockClear(); updateMock.mockClear(); comparePasswordsMock.mockResolvedValue(true); });

describe('PUT /api/portal/settings/password', () => {
  it('changes password when current matches', async () => {
    const res = await PUT(req({ currentPassword: 'old', newPassword: 'newpassword' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('message');
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ password: 'hashed-new' }));
  });

  it('rejects a wrong current password without updating', async () => {
    comparePasswordsMock.mockResolvedValue(false);
    const res = await PUT(req({ currentPassword: 'wrong', newPassword: 'newpassword' }));

    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects a new password shorter than 8 characters', async () => {
    const res = await PUT(req({ currentPassword: 'old', newPassword: 'short' }));
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
