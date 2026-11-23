import { rejectIfDeactivated } from '@/lib/deactivated-staff.server';
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { productCategoryDelete, productCategoryUpdate } from '@/lib/business-routes.server';

async function ownerOnly(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const deactivated = await rejectIfDeactivated(payload);
  if (deactivated) return deactivated;
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  if (payload.role !== 'admin' && payload.role !== 'super_admin') {
    return jsonResponse({ success: false, error: 'Only the workspace owner can manage categories', code: 'FORBIDDEN' }, 403);
  }
  return payload.organizationId;
}

// PATCH /api/mobile/product-categories/{id} — { name?, isActive?, sortOrder? }. Workspace owner only.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const org = await ownerOnly(request);
  if (typeof org !== 'string') return org;
  const { id } = await context.params;
  return productCategoryUpdate(org, id, request);
}

// DELETE /api/mobile/product-categories/{id}[?moveProducts=1]. Workspace owner only.
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const org = await ownerOnly(request);
  if (typeof org !== 'string') return org;
  const { id } = await context.params;
  return productCategoryDelete(org, id, request);
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
