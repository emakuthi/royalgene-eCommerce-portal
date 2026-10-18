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

  describe('addLineToSalesReceipt (one receipt per checkout)', () => {
    const line = { itemId: '7', description: 'Scarf', quantity: 2, unitPriceMajor: 100, totalAmountMajor: 200 };
    const existingReceipt = {
      SalesReceipt: {
        Id: 'r1',
        SyncToken: '3',
        Line: [
          { Id: '1', DetailType: 'SalesItemLineDetail', Amount: 500, SalesItemLineDetail: { ItemRef: { value: '5' }, Qty: 1, UnitPrice: 500 } },
          { DetailType: 'SubTotalLineDetail', Amount: 500 },
        ],
      },
    };

    it('appends the line, keeps the existing ones and drops the computed subtotal', async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ SalesReceipt: { Id: 'r1' } }), { status: 200 })
          : new Response(JSON.stringify(existingReceipt), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const { addLineToSalesReceipt } = await import('../quickbooks.server');

      const result = await addLineToSalesReceipt('realm', 'token', 'r1', line);

      expect(result).toEqual({ ok: true, salesReceiptId: 'r1' });
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
      const body = JSON.parse(String(post[1]!.body));
      expect(body).toMatchObject({ Id: 'r1', SyncToken: '3', sparse: true });
      expect(body.Line).toHaveLength(2);
      expect(body.Line.map((l: { DetailType: string }) => l.DetailType)).toEqual(['SalesItemLineDetail', 'SalesItemLineDetail']);
      expect(body.Line[1]).toMatchObject({ Amount: 200, Description: 'Scarf', SalesItemLineDetail: { Qty: 2, UnitPrice: 100 } });
    });

    it('re-reads and retries once when the first update loses a SyncToken race', async () => {
      let posts = 0;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method !== 'POST') return new Response(JSON.stringify(existingReceipt), { status: 200 });
        posts += 1;
        return posts === 1
          ? new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Stale Object Error' }] } }), { status: 400 })
          : new Response(JSON.stringify({ SalesReceipt: { Id: 'r1' } }), { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      const { addLineToSalesReceipt } = await import('../quickbooks.server');

      const result = await addLineToSalesReceipt('realm', 'token', 'r1', line);

      expect(result.ok).toBe(true);
      expect(posts).toBe(2);
      expect(fetchMock).toHaveBeenCalledTimes(4); // read, update (stale), read, update
    });

    it('reports the QuickBooks error after the retry also fails', async () => {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? new Response(JSON.stringify({ Fault: { Error: [{ Message: 'Stale Object Error' }] } }), { status: 400 })
          : new Response(JSON.stringify(existingReceipt), { status: 200 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const { addLineToSalesReceipt } = await import('../quickbooks.server');

      const result = await addLineToSalesReceipt('realm', 'token', 'r1', line);
      expect(result).toEqual({ ok: false, error: 'Stale Object Error' });
    });
  });
});
