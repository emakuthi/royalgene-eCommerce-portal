import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const setMin = vi.fn();
const setPlay = vi.fn();
let playLive = 0;

vi.mock('@/lib/authorize', () => ({ requireRole: () => ({ userId: 'admin-1' }) }));
vi.mock('@/lib/platform-settings.server', () => ({
  getSelfSignupEnabled: async () => true,
  setSelfSignupEnabled: vi.fn(),
  getAllowAllMobileLogins: async () => false,
  setAllowAllMobileLogins: vi.fn(),
  getMinAppVersionCode: async () => 0,
  setMinAppVersionCode: (...a: unknown[]) => setMin(...a),
  getMinIosVersionCode: async () => 0,
  setMinIosVersionCode: vi.fn(),
  getPlayLiveVersionCode: async () => playLive,
  setPlayLiveVersionCode: (...a: unknown[]) => setPlay(...a),
}));

import { PATCH } from './route';

const patch = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/platform/settings', { method: 'PATCH', body: JSON.stringify(body) }));

describe('PATCH /api/platform/settings minimum version', () => {
  beforeEach(() => {
    setMin.mockReset();
    setPlay.mockReset();
    playLive = 291;
  });

  it('refuses a minimum newer than Play without confirmation', async () => {
    const res = await patch({ minAppVersionCode: 301 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('AHEAD_OF_PLAY');
    expect(setMin).not.toHaveBeenCalled();
  });

  it('allows a minimum newer than Play once confirmed', async () => {
    const res = await patch({ minAppVersionCode: 301, confirmAheadOfPlay: true });
    expect(res.status).toBe(200);
    expect(setMin).toHaveBeenCalledWith(301, 'admin-1');
  });

  it('allows the Play build itself, a lower one, and turning it off', async () => {
    for (const v of [291, 280, 0]) {
      expect((await patch({ minAppVersionCode: v })).status).toBe(200);
    }
    expect(setMin).toHaveBeenCalledTimes(3);
  });

  it('does not block when the Play build was never recorded', async () => {
    playLive = 0;
    expect((await patch({ minAppVersionCode: 301 })).status).toBe(200);
  });

  it('rejects an invalid Play build without saving', async () => {
    expect((await patch({ playLiveVersionCode: -1 })).status).toBe(400);
    expect(setPlay).not.toHaveBeenCalled();
  });
});
