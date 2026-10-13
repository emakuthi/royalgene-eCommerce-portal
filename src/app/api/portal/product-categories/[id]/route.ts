import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { productCategoryUpdate } from '@/lib/business-routes.server';

// PATCH /api/portal/product-categories/{id} — { name?, isActive?, sortOrder? }. Owner only.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await context.params;
  return productCategoryUpdate(auth.organizationId, id, request);
}

export function OPTIONS() {
  return optionsResponse('PATCH,OPTIONS');
}
