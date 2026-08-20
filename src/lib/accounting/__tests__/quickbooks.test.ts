import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('quickbooks.server', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  beforeEach(() => {
    process.env.QUICKBOOKS_CLIENT_ID = 'test-client-id';
    process.env.QUICKBOOKS_CLIENT_SECRET = 'test-client-secret';
    process.env.QUICKBOOKS_ENVIRONMENT = 'sandbox';
  });

  it('isQuickBooksConfigured is true only when both client id and secret are set', async () => {
    const { isQuickBooksConfigured } = await import('../quickbooks.server');
    expect(isQuickBooksConfigured()).toBe(true);

    delete process.env.QUICKBOOKS_CLIENT_SECRET;
    vi.resetModules();
    const reloaded = await import('../quickbooks.server');
    expect(reloaded.isQuickBooksConfigured()).toBe(false);
  });

  it('getAuthorizationUrl returns null when unconfigured, a URL with state when configured', async () => {
    const { getAuthorizationUrl } = await import('../quickbooks.server');
    const url = getAuthorizationUrl('https://tenant.example.com/api/portal/integrations/quickbooks/callback', 'signed-state');
    expect(url).toContain('https://appcenter.intuit.com/connect/oauth2');
    expect(url).toContain('state=signed-state');
    expect(url).toContain(encodeURIComponent('https://tenant.example.com/api/portal/integrations/quickbooks/callback'));
  });

  it('exchangeCodeForTokens posts to the token endpoint and returns parsed tokens', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { exchangeCodeForTokens } = await import('../quickbooks.server');
    const result = await exchangeCodeForTokens('auth-code', 'https://tenant.example.com/cb');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.access_token).toBe('at');
      expect(result.data.refresh_token).toBe('rt');
    }
    expect(fetchMock).toHaveBeenCalledWith('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', expect.objectContaining({ method: 'POST' }));
  });

  it('exchangeCodeForTokens surfaces a clear error on failure', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error_description: 'invalid_grant' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const { exchangeCodeForTokens } = await import('../quickbooks.server');
    const result = await exchangeCodeForTokens('bad-code', 'https://tenant.example.com/cb');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('invalid_grant');
  });

  it('findOrCreateItem reuses an existing item without creating a new one', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ QueryResponse: { Item: [{ Id: '42', Name: 'BD-001' }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { findOrCreateItem } = await import('../quickbooks.server');
    const result = await findOrCreateItem('realm-1', 'token', { sku: 'BD-001', name: 'Blue Dress' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.itemId).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no create call needed
  });

  it('findOrCreateItem creates an item when none is found', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ QueryResponse: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Item: { Id: '99', Name: 'BD-002' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { findOrCreateItem } = await import('../quickbooks.server');
    const result = await findOrCreateItem('realm-1', 'token', { sku: 'BD-002', name: 'Red Dress' });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.itemId).toBe('99');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
