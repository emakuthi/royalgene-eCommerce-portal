import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { productCategoryUpdate } from '@/lib/business-routes.server';

// PATCH /api/mobile/product-categories/{id} — { name?, isActive?, sortOrder? }. Workspace owner only.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  if (payload.role !== 'admin' && payload.role !== 'super_admin') {
    return jsonResponse({ success: false, error: 'Only the workspace owner can manage categories', code: 'FORBIDDEN' }, 403);
  }
  const { id } = await context.params;
  return productCategoryUpdate(payload.organizationId, id, request);
}

export function OPTIONS() {
  return optionsResponse('PATCH,OPTIONS');
}
