/**
 * GET /api/portal/sales/trash
 * Every soft-deleted sale line still on record — admins only. A row stays
 * here for SALE_TRASH_RETENTION_DAYS (90) after deletion; "Empty Trash"
 * (POST .../trash/purge) is the only thing that erases it for good.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listTrashedSales, SALE_TRASH_RETENTION_DAYS } from '@/lib/sale-delete.server';

export async function GET(request: NextRequest) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth;

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can view deleted sales.' }, 403);
    }

    const sales = await listTrashedSales(payload.organizationId as string);
    return jsonResponse({ success: true, data: { sales, retentionDays: SALE_TRASH_RETENTION_DAYS } }, 200);
  } catch (error) {
    logger.error('Sales trash list error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
