import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { updateCategory } from '@/lib/expenses.server';

// PATCH /api/portal/expense-categories/{id} — { name?, isActive? }
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: { name?: string; isActive?: boolean } = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
  if (Object.keys(patch).length === 0) return jsonResponse({ success: false, error: 'Nothing to update' }, 400);
  const data = await updateCategory(id, auth.organizationId, patch);
  if (!data) return jsonResponse({ success: false, error: 'Category not found' }, 404);
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('PATCH,OPTIONS');
}
