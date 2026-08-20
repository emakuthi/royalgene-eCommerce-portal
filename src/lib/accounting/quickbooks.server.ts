import 'server-only';
import logger from '../logger';

/**
 * Plain-fetch QuickBooks Online API wrapper — no SDK, matching how
 * paystack.server.ts/vercel.server.ts are built. Requires a platform-level
 * Intuit Developer app (QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET) that
 * only the account owner can register — this fails soft ("not configured")
 * without it, same as every other integration in this app.
 *
 * IMPORTANT: this has not been exercised against a live QuickBooks sandbox
 * account in this session (no credentials were available to test with).
 * The request/response shapes follow Intuit's published API docs as
 * closely as possible, but treat this as unverified until tested against a
 * real sandbox company — sync failures surface in AccountingSyncLog rather
 * than silently succeeding, specifically so issues are visible to iterate on.
 */

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SCOPE = 'com.intuit.quickbooks.accounting';

export function isQuickBooksConfigured(): boolean {
  return Boolean(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}

function getApiBaseUrl(realmId: string): string {
  const env = process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  const host = env === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
  return `${host}/v3/company/${encodeURIComponent(realmId)}`;
}

export function getAuthorizationUrl(redirectUri: string, state: string): string | null {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPE,
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(body: URLSearchParams): Promise<{ ok: true; data: TokenResponse } | { ok: false; error: string }> {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'QuickBooks is not configured (QUICKBOOKS_CLIENT_ID/QUICKBOOKS_CLIENT_SECRET missing)' };
  }

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = typeof json?.error_description === 'string' ? json.error_description : `QuickBooks token request failed (${res.status})`;
      logger.warn('[quickbooks] token request failed', { status: res.status, message });
      return { ok: false, error: message };
    }
    return { ok: true, data: json as TokenResponse };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'QuickBooks token request failed' };
  }
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  return tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
}

export async function refreshAccessToken(refreshToken: string) {
  return tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }));
}

async function apiFetch<T>(realmId: string, accessToken: string, path: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${getApiBaseUrl(realmId)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = json?.Fault?.Error?.[0]?.Message || `QuickBooks API request failed (${res.status})`;
      return { ok: false, error: message };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'QuickBooks API request failed' };
  }
}

interface QuickBooksItem {
  Id: string;
  Name: string;
}

/** Finds a QuickBooks Item by SKU (used as its Name), creating a minimal Service item if none exists. */
export async function findOrCreateItem(
  realmId: string,
  accessToken: string,
  input: { sku: string; name: string },
): Promise<{ ok: true; itemId: string } | { ok: false; error: string }> {
  const escapedSku = input.sku.replace(/'/g, "\\'");
  const query = await apiFetch<{ QueryResponse?: { Item?: QuickBooksItem[] } }>(
    realmId,
    accessToken,
    `/query?query=${encodeURIComponent(`SELECT * FROM Item WHERE Name = '${escapedSku}'`)}`,
  );
  if (query.ok && query.data.QueryResponse?.Item?.length) {
    return { ok: true, itemId: query.data.QueryResponse.Item[0].Id };
  }

  const create = await apiFetch<{ Item: QuickBooksItem }>(realmId, accessToken, '/item', {
    method: 'POST',
    body: JSON.stringify({ Name: input.sku, Type: 'Service' }),
  });
  if (!create.ok) return create;
  return { ok: true, itemId: create.data.Item.Id };
}

export interface CreateSalesReceiptInput {
  itemId: string;
  description: string;
  quantity: number;
  unitPriceMajor: number; // major currency unit (e.g. KES, not cents)
  totalAmountMajor: number;
}

export async function createSalesReceipt(
  realmId: string,
  accessToken: string,
  input: CreateSalesReceiptInput,
): Promise<{ ok: true; salesReceiptId: string } | { ok: false; error: string }> {
  const result = await apiFetch<{ SalesReceipt: { Id: string } }>(realmId, accessToken, '/salesreceipt', {
    method: 'POST',
    body: JSON.stringify({
      Line: [{
        Amount: input.totalAmountMajor,
        Description: input.description,
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: input.itemId },
          Qty: input.quantity,
          UnitPrice: input.unitPriceMajor,
        },
      }],
    }),
  });
  if (!result.ok) return result;
  return { ok: true, salesReceiptId: result.data.SalesReceipt.Id };
}
