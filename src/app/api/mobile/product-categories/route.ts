import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listProductCategories } from '@/lib/business-settings.server';
import { productCategoryCreate } from '@/lib/business-routes.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}

// GET /api/mobile/product-categories[?activeOnly=1]
export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  const activeOnly = new URL(request.url).searchParams.get('activeOnly') === '1';
  return jsonResponse({ success: true, data: await listProductCategories(payload.organizationId, { activeOnly }) });
}

// POST /api/mobile/product-categories — { name }. Workspace owner only.
export async function POST(request: NextRequest) {
  const payload = authed(request);
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  if (payload.role !== 'admin' && payload.role !== 'super_admin') {
    return jsonResponse({ success: false, error: 'Only the workspace owner can manage categories', code: 'FORBIDDEN' }, 403);
  }
  return productCategoryCreate(payload.organizationId, request);
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
