import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth so the route sees an authenticated org admin for organization "org-1".
vi.mock('@/lib/authorize', () => ({
  requireAuth: vi.fn(() => ({ userId: 'user-1', role: 'admin', organizationId: 'org-1' })),
}));

// The enforcement check itself is unit-tested in src/lib/entitlements/__tests__/enforce.test.ts —
// here we only need to confirm the shops route actually calls it and respects the result.
const assertCanCreateMock = vi.fn();
vi.mock('@/lib/entitlements/enforce.server', () => ({
  assertCanCreate: (...args: unknown[]) => assertCanCreateMock(...args),
}));

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      // Duplicate-name check: .select('id').eq('organizationId', id).ilike('name', name).limit(1).single()
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          ilike: vi.fn(() => ({
            limit: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: null })) })),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'shop-new', name: 'New Shop' }, error: null })) })),
      })),
    })),
  },
}));

import { POST } from './route';

function makeRequest() {
  return new NextRequest('http://localhost/api/portal/shops', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: JSON.stringify({ name: 'New Shop', location: 'Nairobi' }),
  });
}

describe('POST /api/portal/shops — plan limit enforcement', () => {
  it('returns 403 PLAN_LIMIT_REACHED when the branch limit is hit', async () => {
    assertCanCreateMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, code: 'PLAN_LIMIT_REACHED', feature: 'BRANCHES', limit: 1, currentUsage: 1, upgradeRequired: true }), { status: 403 }),
    );

    const res = await POST(makeRequest());
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe('PLAN_LIMIT_REACHED');
    expect(assertCanCreateMock).toHaveBeenCalledWith('org-1', 'BRANCH');
  });

  it('creates the shop when under the limit', async () => {
    assertCanCreateMock.mockResolvedValueOnce(null);

    const res = await POST(makeRequest());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe('shop-new');
  });
});
