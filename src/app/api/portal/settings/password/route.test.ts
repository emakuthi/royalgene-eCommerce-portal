import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockUser = { id: 'user-1', password: '$2a$10$abcdefg' };

vi.mock('@/lib/auth', () => ({
  extractTokenFromHeader: (h: string | null | undefined) => 'token',
  verifyToken: (t: string | null | undefined) => ({ userId: 'user-1' }),
  comparePasswords: async (plain: string, hashed: string) => true,
  hashPassword: async (p: string) => 'hashed-new',
}));

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'User') {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: mockUser, error: null })) })) })),
          update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
        };
      }
      return {};
    }),
  },
}));

import { PUT } from './route';

describe('PUT /api/portal/settings/password', () => {
  it('changes password when current matches', async () => {
    const body = JSON.stringify({ currentPassword: 'old', newPassword: 'newpassword' });
    const req = new Request('http://localhost/api/portal/settings/password', {
      method: 'PUT',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body,
    });

    const res = await PUT(req as NextRequest);
    const json = await res.json();

    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('message');
  });
});

