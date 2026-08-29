import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mock: { row: unknown; updateError: { message: string } | null; lastUpdate: unknown } = {
  row: null,
  updateError: null,
  lastUpdate: null,
};

function builder() {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.update = vi.fn((u: unknown) => { mock.lastUpdate = u; return b; });
  b.maybeSingle = vi.fn(async () => ({ data: mock.row, error: mock.updateError }));
  return b;
}

vi.mock('@/lib/supabase-client', () => ({ supabaseAdmin: { from: vi.fn(() => builder()) } }));

import { getTenantBranding, updateTenantBranding } from '@/lib/branding.server';
import { BRANDING_DEFAULTS, MAX_BRANDING_DATA_URI_BYTES } from '@/lib/branding';

beforeEach(() => { mock.row = null; mock.updateError = null; mock.lastUpdate = null; });
afterEach(() => { vi.clearAllMocks(); });

describe('getTenantBranding', () => {
  it('returns defaults for a missing org id', async () => {
    expect(await getTenantBranding(null)).toEqual(BRANDING_DEFAULTS);
  });

  it('maps an org row, falling back to defaults for blank fields', async () => {
    mock.row = { name: 'Acme Retail', tagline: '   ', logoUrl: 'data:image/png;base64,AAA', faviconUrl: null };
    const b = await getTenantBranding('org-1');
    expect(b).toEqual({
      companyName: 'Acme Retail',
      tagline: BRANDING_DEFAULTS.tagline,
      logoUrl: 'data:image/png;base64,AAA',
      faviconUrl: null,
    });
  });
});

describe('updateTenantBranding', () => {
  it('rejects a non-data-URI logo', async () => {
    await expect(updateTenantBranding('org-2', { logoUrl: 'https://evil.example/x.png' }))
      .rejects.toThrow(/image data URI/);
  });

  it('rejects an oversized favicon', async () => {
    const big = 'data:image/png;base64,' + 'A'.repeat(MAX_BRANDING_DATA_URI_BYTES + 10);
    await expect(updateTenantBranding('org-2', { faviconUrl: big })).rejects.toThrow(/too large/);
  });

  it('rejects a too-short company name', async () => {
    await expect(updateTenantBranding('org-2', { companyName: 'x' })).rejects.toThrow(/2–100/);
  });

  it('clears logo/favicon on null and empties the tagline', async () => {
    mock.row = { name: 'Acme', tagline: null, logoUrl: null, faviconUrl: null };
    await updateTenantBranding('org-2', { logoUrl: null, faviconUrl: null, tagline: '' });
    expect(mock.lastUpdate).toMatchObject({ logoUrl: null, faviconUrl: null, tagline: null });
  });

  it('persists a valid data-URI logo + trimmed name', async () => {
    mock.row = { name: 'Acme Retail', tagline: 'Shops', logoUrl: 'data:image/png;base64,AAA', faviconUrl: null };
    const b = await updateTenantBranding('org-2', { companyName: '  Acme Retail  ', logoUrl: 'data:image/png;base64,AAA' });
    expect(mock.lastUpdate).toMatchObject({ name: 'Acme Retail', logoUrl: 'data:image/png;base64,AAA' });
    expect(b.companyName).toBe('Acme Retail');
  });
});
