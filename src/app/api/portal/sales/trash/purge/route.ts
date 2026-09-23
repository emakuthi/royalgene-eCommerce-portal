/**
 * POST /api/portal/sales/trash/purge
 * "Empty Trash" — permanently erases every deleted sale past its
 * SALE_TRASH_RETENTION_DAYS (90-day) window. Admins only. No cron runs
 * this automatically (by design — see project notes); it only runs when an
 * admin actually clicks the button, and only ever removes rows already due.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { trackFromRequest } from '@/lib/activity-tracker';
import { purgeExpiredDeletedSales } from '@/lib/sale-delete.server';

export async function POST(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can empty the sales trash.' }, 403);
    }

    const { purged } = await purgeExpiredDeletedSales(payload.organizationId as string);

    void trackFromRequest(request, payload, { action: 'sale.trash_purge', category: 'sale', details: { purged } });
    logger.info('Sales trash purged', { organizationId: payload.organizationId, userId: payload.userId, purged });

    return jsonResponse({ success: true, data: { purged }, message: purged > 0 ? `${purged} permanently removed` : 'Nothing was due for removal yet' }, 200);
  } catch (error) {
    logger.error('Sales trash purge error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
