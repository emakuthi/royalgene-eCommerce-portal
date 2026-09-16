import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse } from '@/lib/apiResponse';
import { decodeCursor, encodeCursor, pullChanges } from '@/lib/sync/pull.server';
import { SYNC_ENTITY_NAMES, type SyncEntityName } from '@/lib/sync/syncable-entities';
import logger from '@/lib/logger';
import { canViewCostData } from '@/lib/cost-visibility.server';

/**
 * GET /api/mobile/sync/changes?since=<cursor>&entities=Product,SalesEntry&limit=200
 *
 * Incremental pull for the offline-first Android app. Never downloads the
 * whole database: `since` is an opaque cursor (echo back whatever this
 * endpoint returned last time; omit it for a first sync). The response is
 * scoped to the CALLER'S organizationId, taken from the verified JWT — a
 * client cannot request another tenant's data by passing a different org id,
 * because none is ever read from the request.
 *
 * Call again with the returned cursor while `hasMore` is true.
 */
export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);

    // A platform account has no tenant data to sync — mirrors the rest of
    // the mobile API (requireTenantUser / verifyMobileShopAccess).
    if (!payload.organizationId) {
      return jsonResponse({ success: false, error: 'Platform accounts cannot sync tenant data.', code: 'PLATFORM_NO_TENANT_DATA' }, 403);
    }

    const { searchParams } = new URL(request.url);
    const cursor = decodeCursor(searchParams.get('since'));

    const entitiesParam = searchParams.get('entities');
    const entities = entitiesParam
      ? entitiesParam.split(',').map((s) => s.trim()).filter((s): s is SyncEntityName =>
          (SYNC_ENTITY_NAMES as string[]).includes(s))
      : undefined;

    const limitParam = Number(searchParams.get('limit'));
    const pageSize = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

    const result = await pullChanges({
      organizationId: payload.organizationId,
      cursor,
      entities,
      pageSize,
      // Cost/profit figures are owner-only and this feed lands in the
      // device's local DB, so gate them here rather than in the UI.
      includeCostData: await canViewCostData(payload),
    });

    return jsonResponse({
      success: true,
      data: {
        cursor: encodeCursor(result.cursor),
        changes: result.changes,
        hasMore: result.hasMore,
      },
    }, 200);
  } catch (error) {
    logger.error('[sync] GET /api/mobile/sync/changes error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
