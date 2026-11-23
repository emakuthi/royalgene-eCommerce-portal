import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const hasCapability = vi.fn();
vi.mock('../../permissions.server', () => ({ hasCapability: (...a: unknown[]) => hasCapability(...a) }));
vi.mock('../../shop-access.server', () => ({ assignedShops: vi.fn(async () => null) }));
const getDriveAccess = vi.fn();
vi.mock('../drive-connection.server', () => ({
  getDriveAccess: (...a: unknown[]) => getDriveAccess(...a),
  setDriveFolder: vi.fn(),
}));
const uploadFile = vi.fn();
const folderIsLive = vi.fn();
const ensureFolder = vi.fn();
vi.mock('../../google-drive.server', () => ({
  DriveError: class DriveError extends Error { constructor(m: string, readonly status: number) { super(m); } },
  uploadFile: (...a: unknown[]) => uploadFile(...a),
  folderIsLive: (...a: unknown[]) => folderIsLive(...a),
  ensureFolder: (...a: unknown[]) => ensureFolder(...a),
  downloadFile: vi.fn(),
  trashFile: vi.fn(),
}));

// Minimal supabase stand-in: lookups return `found[table]`, inserts echo the row back.
const found: Record<string, unknown> = {};
const inserted: Record<string, unknown>[] = [];
vi.mock('../../supabase-client', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self, eq: self, is: self,
        maybeSingle: async () => ({ data: found[table] ?? null }),
        insert: (rows: Record<string, unknown>[]) => {
          inserted.push(rows[0]);
          return { select: () => ({ single: async () => ({ data: { id: '11111111-1111-1111-1111-111111111111', ...rows[0] }, error: null }) }) };
        },
      });
      return chain;
    },
  },
}));

import { cleanReceiptInput, createReceipt, receiptFileName } from '../receipts.server';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(found)) delete found[k];
  inserted.length = 0;
});

describe('receiptFileName', () => {
  it('reads as date, supplier and amount, with unsafe characters taken out', () => {
    expect(receiptFileName({ receiptDate: '2026-11-20', supplier: 'Mama/Mboga: "fresh"', amount: 1250 }, 'jpg', '2026-11-23'))
      .toBe('2026-11-20 Mama Mboga fresh 1250.jpg');
    expect(receiptFileName({}, 'pdf', '2026-11-23')).toBe('2026-11-23 Receipt.pdf');
  });
});

describe('cleanReceiptInput', () => {
  it('refuses a negative amount and a badly written date', async () => {
    expect(await cleanReceiptInput('org-1', { amount: -5 })).toMatchObject({ ok: false, status: 400 });
    expect(await cleanReceiptInput('org-1', { receiptDate: '20/11/2026' })).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses an expense from another workspace, and takes the shop from the expense", async () => {
    expect(await cleanReceiptInput('org-1', { expenseId: 'e-1' })).toMatchObject({ ok: false, status: 404 });
    found.Expense = { id: 'e-1', shopId: 'shop-a' };
    found.Shop = { id: 'shop-a' };
    expect(await cleanReceiptInput('org-1', { expenseId: 'e-1', amount: '1250.456', currency: 'kes', supplier: '  Duka  ' }))
      .toEqual({ ok: true, value: expect.objectContaining({ expenseId: 'e-1', shopId: 'shop-a', amount: 1250.46, currency: 'KES', supplier: 'Duka' }) });
  });
});

describe('createReceipt', () => {
  const jpg = { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg' };

  it('says Drive must be connected first, and saves nothing', async () => {
    getDriveAccess.mockResolvedValue({ ok: false, reason: 'not_connected' });
    expect(await createReceipt('org-1', 'u-1', jpg, {})).toMatchObject({ ok: false, status: 409, code: 'DRIVE_NOT_CONNECTED' });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('only takes photos and PDFs', async () => {
    expect(await createReceipt('org-1', 'u-1', { bytes: new Uint8Array([1]), mimeType: 'text/html' }, {})).toMatchObject({ ok: false, status: 415 });
  });

  it("files it under the receipt's month in Drive and keeps only the pointer", async () => {
    getDriveAccess.mockResolvedValue({ ok: true, accessToken: 'tok', folderId: 'root' });
    folderIsLive.mockResolvedValue(true);
    ensureFolder.mockResolvedValue('month-folder');
    uploadFile.mockResolvedValue({ id: 'drive-file-1', webViewLink: null });
    const result = await createReceipt('org-1', 'u-1', jpg, { receiptDate: '2026-10-31', supplier: 'Duka', amount: 900 });
    expect(ensureFolder).toHaveBeenCalledWith('tok', '2026-10', 'root');
    expect(uploadFile).toHaveBeenCalledWith('tok', expect.objectContaining({ parentId: 'month-folder', name: '2026-10-31 Duka 900.jpg' }));
    expect(inserted[0]).toMatchObject({ driveFileId: 'drive-file-1', organizationId: 'org-1', uploadedBy: 'u-1', sizeBytes: 3 });
    expect(result).toMatchObject({ ok: true, receipt: { supplier: 'Duka', amount: 900, receiptDate: '2026-10-31' } });
  });

  it('remakes "RoyalTrack Receipts" when the owner deleted it', async () => {
    getDriveAccess.mockResolvedValue({ ok: true, accessToken: 'tok', folderId: 'gone' });
    folderIsLive.mockResolvedValue(false);
    ensureFolder.mockResolvedValueOnce('new-root').mockResolvedValueOnce('month-folder');
    uploadFile.mockResolvedValue({ id: 'f', webViewLink: null });
    await createReceipt('org-1', 'u-1', jpg, { receiptDate: '2026-11-01' });
    expect(ensureFolder).toHaveBeenNthCalledWith(1, 'tok', 'RoyalTrack Receipts');
    expect(ensureFolder).toHaveBeenNthCalledWith(2, 'tok', '2026-11', 'new-root');
  });
});
