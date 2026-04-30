import { describe, it, expect, vi } from 'vitest';

const mockData = { id: 'test-id', title: 'Test', message: 'Hello', level: 'info', read: false };

// Mock the supabase client module before importing the route so the route picks up the mock
vi.mock('@/lib/supabase-client', () => {
  const single = vi.fn(async () => ({ data: mockData, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { supabaseAdmin: { from } };
});

import { POST } from './route';

describe('POST /api/portal/alerts', () => {
  it('creates an alert and returns success', async () => {
    const payload = { title: 'Test', message: 'Hello', level: 'info', shopId: 'shop-1' };

    const req = new Request('http://localhost/api/portal/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req as unknown as Request);
    const json = await res.json();

    expect(json).toHaveProperty('success', true);
    expect(json).toHaveProperty('data');
    expect(json.data).toHaveProperty('id', 'test-id');
    expect(json.data).toHaveProperty('title', 'Test');
  });
});
