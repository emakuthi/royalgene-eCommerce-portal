import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockData = { id: 'test-id', title: 'Test', message: 'Hello', level: 'info', read: false };

// Mock auth so the route sees an authenticated admin for organization "org-1".
vi.mock('@/lib/authorize', () => ({
  requireAuth: vi.fn(() => ({ userId: 'user-1', role: 'admin', organizationId: 'org-1' })),
}));

// Mock the supabase client module before importing the route so the route picks up the mock.
// Different tables need different chain shapes: Shop lookup (maybeSingle) vs Alert insert (single).
vi.mock('@/lib/supabase-client', () => {
  const from = vi.fn((table: string) => {
    if (table === 'Shop') {
      return { select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: { id: 'shop-1' }, error: null })) })) })) })) };
    }
    return { insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: mockData, error: null })) })) })) };
  });
  return { supabaseAdmin: { from } };
});

import { POST } from './route';

describe('POST /api/portal/alerts', () => {
  it('creates an alert and returns success for an authenticated request', async () => {
    const payload = { title: 'Test', message: 'Hello', level: 'info', shopId: 'shop-1' };

    const req = new NextRequest('http://localhost/api/portal/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('id', 'test-id');
    expect(json.data).toHaveProperty('title', 'Test');
  });
});
