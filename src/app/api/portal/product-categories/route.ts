import { NextRequest, NextResponse } from 'next/server';
import { requireRole, requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listProductCategories } from '@/lib/business-settings.server';
import { productCategoryCreate } from '@/lib/business-routes.server';

// GET /api/portal/product-categories[?activeOnly=1]
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const activeOnly = new URL(request.url).searchParams.get('activeOnly') === '1';
  return jsonResponse({ success: true, data: await listProductCategories(auth.organizationId, { activeOnly }) });
}

// POST /api/portal/product-categories — { name }. Owner only.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  return productCategoryCreate(auth.organizationId, request);
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
