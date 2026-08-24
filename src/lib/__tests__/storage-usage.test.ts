import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSupabaseMock, type MockTables } from '../entitlements/__tests__/supabase-mock';

const ORG_ID = 'org-1';

let mockTables: MockTables;
const storageRemove = vi.fn(async () => ({ error: null }));

vi.mock('../supabase-client', () => ({
  get supabaseAdmin() {
    const base = createSupabaseMock(mockTables);
    return {
      ...base,
      storage: { from: vi.fn(() => ({ remove: storageRemove })) },
    };
  },
}));

beforeEach(() => {
  mockTables = { TenantFileUpload: [] };
  storageRemove.mockClear();
  storageRemove.mockResolvedValue({ error: null });
});

describe('parseStorageUrl', () => {
  it('extracts bucket and tenant-prefixed path from a public Storage URL', async () => {
    const { parseStorageUrl } = await import('../storage-usage.server');
    const url = 'https://xyz.supabase.co/storage/v1/object/public/products/org-abc/photo-123.jpg';
    expect(parseStorageUrl(url)).toEqual({ bucket: 'products', path: 'org-abc/photo-123.jpg' });
  });

  it('decodes URL-encoded characters in the path', async () => {
    const { parseStorageUrl } = await import('../storage-usage.server');
    const url = 'https://xyz.supabase.co/storage/v1/object/public/products/org-abc/my%20photo.jpg';
    expect(parseStorageUrl(url)).toEqual({ bucket: 'products', path: 'org-abc/my photo.jpg' });
  });

  it('strips a trailing query string', async () => {
    const { parseStorageUrl } = await import('../storage-usage.server');
    const url = 'https://xyz.supabase.co/storage/v1/object/public/products/org-abc/photo.jpg?t=123';
    expect(parseStorageUrl(url)).toEqual({ bucket: 'products', path: 'org-abc/photo.jpg' });
  });

  it('returns null for a URL that is not a Supabase Storage public URL', async () => {
    const { parseStorageUrl } = await import('../storage-usage.server');
    expect(parseStorageUrl('https://example.com/some/image.jpg')).toBeNull();
  });
});

describe('deleteUploadedFile', () => {
  it('removes the file from Storage and marks the matching ledger row deleted', async () => {
    mockTables.TenantFileUpload = [
      { organizationId: ORG_ID, storagePath: 'org-1/photo.jpg', sizeBytes: 1000, deletedAt: null },
    ];
    const { deleteUploadedFile } = await import('../storage-usage.server');
    await deleteUploadedFile('https://xyz.supabase.co/storage/v1/object/public/products/org-1/photo.jpg', ORG_ID);

    expect(storageRemove).toHaveBeenCalledWith(['org-1/photo.jpg']);
    expect(mockTables.TenantFileUpload[0].deletedAt).not.toBeNull();
  });

  it('does not touch another organization\'s ledger row even with the same path filter attempted', async () => {
    mockTables.TenantFileUpload = [
      { organizationId: 'org-other', storagePath: 'org-1/photo.jpg', sizeBytes: 1000, deletedAt: null },
    ];
    const { deleteUploadedFile } = await import('../storage-usage.server');
    await deleteUploadedFile('https://xyz.supabase.co/storage/v1/object/public/products/org-1/photo.jpg', ORG_ID);

    expect(mockTables.TenantFileUpload[0].deletedAt).toBeNull();
  });

  it('is a no-op for a URL that does not match the Storage URL shape', async () => {
    const { deleteUploadedFile } = await import('../storage-usage.server');
    await deleteUploadedFile('not-a-storage-url', ORG_ID);
    expect(storageRemove).not.toHaveBeenCalled();
  });
});
