import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('../receipts.server', () => ({
  MAX_RECEIPT_BYTES: 10 * 1024 * 1024,
  canManageReceipts: vi.fn(async () => false),
  listReceipts: vi.fn(),
  createReceipt: vi.fn(),
  cleanReceiptInput: vi.fn(),
  findReceipt: vi.fn(),
  updateReceipt: vi.fn(),
  deleteReceipt: vi.fn(),
  openReceiptFile: vi.fn(),
}));
vi.mock('../../shop-access.server', () => ({ denyUnlessShopAllowed: vi.fn(async () => null) }));

import { handleListReceipts, handleReceiptFile } from '../receipt-routes.server';
import { listReceipts, openReceiptFile } from '../receipts.server';

const staff = { userId: 'u-1', organizationId: 'org-1', role: 'user' } as never;

describe('receipt routes', () => {
  it('refuse staff without the Manage receipts permission', async () => {
    const res = await handleListReceipts(new NextRequest('http://localhost/api/portal/receipts'), staff);
    expect(res.status).toBe(403);
    expect(listReceipts).not.toHaveBeenCalled();
    expect((await handleReceiptFile(staff, 'x', false)).status).toBe(403);
    expect(openReceiptFile).not.toHaveBeenCalled();
  });
});
