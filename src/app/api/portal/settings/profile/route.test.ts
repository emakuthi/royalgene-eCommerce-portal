import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockUpdatedUser = { id: 'user-1', email: 'u@example.com', name: 'Updated', phone: '0700000000' };

// The route authenticates via requireAuth (@/lib/authorize); this test used to
// mock the retired @/lib/auth, so the real JWT check rejected the fake token.
vi.mock('@/lib/authorize', () => ({ requireAuth: vi.fn(() => ({ userId: 'user-1' })) }));

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: mockUpdatedUser, error: null })),
          })),
        })),
      })),
    })),
  },
}));

import { PUT } from './route';

describe('PUT /api/portal/settings/profile', () => {
  it('updates profile and returns updated user', async () => {
    const body = JSON.stringify({ name: 'Updated', phone: '0700000000' });
    const req = new Request('http://localhost/api/portal/settings/profile', {
      method: 'PUT',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body,
    });

    const res = await PUT(req as NextRequest);
    const json = await res.json();

    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('data');
    expect(json.data).toEqual({ id: 'user-1', email: 'u@example.com', name: 'Updated', phone: '0700000000' });
  });
});

