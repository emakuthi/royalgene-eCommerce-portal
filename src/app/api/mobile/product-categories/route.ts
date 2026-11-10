import { rejectIfDeactivated } from '@/lib/deactivated-staff.server';
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listProductCategories } from '@/lib/business-settings.server';
import { productCategoryCreate } from '@/lib/business-routes.server';
import { hasCapability } from '@/lib/permissions.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}

// GET /api/mobile/product-categories[?activeOnly=1]
export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const deactivated = await rejectIfDeactivated(payload);
  if (deactivated) return deactivated;
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  const activeOnly = new URL(request.url).searchParams.get('activeOnly') === '1';
  return jsonResponse({ success: true, data: await listProductCategories(payload.organizationId, { activeOnly }) });
}

// POST /api/mobile/product-categories — { name }. Anyone who may add products
// (owners, and managers by default), so a missing category doesn't block a new product.
// Renaming and removing stay owner-only ([id]/route.ts).
export async function POST(request: NextRequest) {
  const payload = authed(request);
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const deactivated = await rejectIfDeactivated(payload);
  if (deactivated) return deactivated;
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  if (!(await hasCapability(payload, 'add_inventory'))) {
    return jsonResponse({ success: false, error: 'Your role may not add categories', code: 'FORBIDDEN' }, 403);
  }
  return productCategoryCreate(payload.organizationId, request);
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
