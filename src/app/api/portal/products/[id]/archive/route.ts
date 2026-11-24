import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { hasCapability } from '@/lib/permissions.server';
import { handleArchiveRequest } from '@/lib/product-archive.server';
import logger from '@/lib/logger';

/**
 * POST /api/portal/products/[id]/archive   { archived: boolean }
 * Archive an out-of-stock product (hidden until unarchived or restocked), or bring it back.
 * Workspace admins with edit_inventory only.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireTenantUser(request);
    if (auth instanceof NextResponse) return auth;
    const isAdmin = auth.role === 'admin' || auth.role === 'super_admin';
    if (!isAdmin || !(await hasCapability(auth, 'edit_inventory'))) {
      return jsonResponse({ success: false, error: 'Only workspace admins can archive products.', code: 'FORBIDDEN' }, 403);
    }
    const { id } = await context.params;
    return await handleArchiveRequest(request, auth, auth.organizationId as string, id);
  } catch (error) {
    logger.error('Portal product archive error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
