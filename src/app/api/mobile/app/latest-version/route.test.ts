import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase-client', () => ({
  supabaseAdmin: {
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
      }),
    }),
  },
}));

vi.mock('@/lib/platform-settings.server', () => ({
  getMinAppVersionCode: vi.fn(async () => 291),
  getMinIosVersionCode: vi.fn(async () => 12),
}));

import { GET } from './route';

const get = (query: string) => GET(new NextRequest(`https://royaltrack.test/api/mobile/app/latest-version${query}`));

describe('GET latest-version policy', () => {
  it('gives iOS its own minimum, marked as being for iOS', async () => {
    const body = await (await get('?platform=ios')).json();
    expect(body.policy).toEqual({ platform: 'ios', minVersionCode: 12, storeUrl: null });
  });

  it("leaves Android's policy unchanged", async () => {
    for (const query of ['?platform=android', '']) {
      const body = await (await get(query)).json();
      expect(body.policy.minVersionCode).toBe(291);
      expect(body.policy.playStoreUrl).toContain('play.google.com');
      expect(body.policy.platform).toBeUndefined();
    }
  });
});
