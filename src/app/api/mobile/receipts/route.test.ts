import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
const verifyToken = vi.fn();
vi.mock('@/lib/auth.server', () => ({ verifyToken: (t: string) => verifyToken(t) }));
vi.mock('@/lib/deactivated-staff.server', () => ({ rejectIfDeactivated: vi.fn(async () => null) }));
const handleListReceipts = vi.fn(async () => new Response('{"success":true,"data":[]}'));
vi.mock('@/lib/receipts/receipt-routes.server', () => ({
  handleListReceipts: (...a: unknown[]) => handleListReceipts(...(a as [])),
  handleCreateReceipt: vi.fn(),
}));

import { GET } from './route';

describe('GET /api/mobile/receipts', () => {
  it('needs a valid app token', async () => {
    verifyToken.mockReturnValue(null);
    const res = await GET(new NextRequest('http://localhost/api/mobile/receipts'));
    expect(res.status).toBe(401);
    expect(handleListReceipts).not.toHaveBeenCalled();
  });

  it('hands the verified user to the shared handler', async () => {
    const payload = { userId: 'u-1', organizationId: 'org-1', role: 'admin' };
    verifyToken.mockReturnValue(payload);
    const res = await GET(new NextRequest('http://localhost/api/mobile/receipts', { headers: { Authorization: 'Bearer t' } }));
    expect(res.status).toBe(200);
    expect(handleListReceipts).toHaveBeenCalledWith(expect.anything(), payload);
  });
});
