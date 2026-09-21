/**
 * GET /api/mobile/transfers?status=&limit=&offset=
 * The transfer list: every stock transfer (instant or two-party request,
 * any status) with enough detail to render the list AND the detail screen in
 * one call — who initiated it and from which shop, the receiving shop, the
 * product, and the size/colour breakdown when there is one.
 *
 * Scope: an admin sees every transfer in their organization; anyone else sees
 * only transfers that touch a shop they're assigned to (as sender or receiver).
 */
import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';

const STATUSES = ['pending', 'confirmed', 'rejected', 'cancelled'];

const SELECT = [
  '*',
  'product:Product(id, name, sku, images)',
  'fromShop:Shop!StockTransfer_fromShopId_fkey(id, name)',
  'toShop:Shop!StockTransfer_toShopId_fkey(id, name)',
  'initiatedBy:PortalUser!StockTransfer_initiatedByPortalUserId_fkey(id, position, user:User(name, email))',
  'resolvedBy:PortalUser!StockTransfer_resolvedByPortalUserId_fkey(id, position, user:User(name, email))',
].join(', ');

type Person = { id: string; position: string | null; user: { name: string | null; email: string | null } | null } | null;

const person = (p: Person) => (p ? { name: p.user?.name ?? null, email: p.user?.email ?? null, position: p.position ?? null } : null);

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyMobileAuth(request);
    if (auth instanceof Response) return auth;

    const organizationId = auth.payload.organizationId ?? null;
    if (!organizationId) {
      return jsonResponse({ success: false, error: 'Platform accounts cannot access tenant business data.', code: 'PLATFORM_NO_TENANT_DATA' }, 403);
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100', 10) || 100, 1), 200);
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

    let query = supabaseAdmin
      .from('StockTransfer')
      .select(SELECT, { count: 'exact' })
      .eq('organizationId', organizationId)
      .order('initiatedAt', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && STATUSES.includes(status)) query = query.eq('status', status);

    if (!auth.isAdmin) {
      const { data: memberships } = await supabaseAdmin
        .from('PortalUser')
        .select('shopId')
        .eq('userId', auth.payload.userId);
      const shopIds = [...new Set((memberships ?? []).map((m: { shopId: string | null }) => m.shopId).filter(Boolean))] as string[];
      if (shopIds.length === 0) {
        return jsonResponse({ success: true, data: { transfers: [], total: 0 } }, 200);
      }
      const list = shopIds.join(',');
      query = query.or(`fromShopId.in.(${list}),toShopId.in.(${list})`);
    }

    const { data, error, count } = await query;
    if (error) {
      logger.error('Mobile transfers list failed', { error: error.message, organizationId });
      return jsonResponse({ success: false, error: 'Failed to fetch transfers', code: 'INTERNAL_ERROR' }, 500);
    }

    const transfers = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
      const { initiatedBy, resolvedBy, ...rest } = row;
      return {
        ...rest,
        initiatedBy: person(initiatedBy as Person),
        resolvedBy: person(resolvedBy as Person),
      };
    });

    return jsonResponse({ success: true, data: { transfers, total: count ?? transfers.length } }, 200);
  } catch (error) {
    logger.error('Mobile transfers list error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
