import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { updateRecurring, deleteRecurring } from '@/lib/recurring-expenses.server';

// PATCH /api/portal/recurring-expenses/[id] — toggle active, edit amount/etc.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updated = await updateRecurring(id, auth.organizationId, {
    isActive: typeof body.isActive === 'boolean' ? body.isActive : undefined,
    amount: body.amount != null ? Number(body.amount) : undefined,
    description: body.description !== undefined ? (body.description as string | null) : undefined,
    endDate: body.endDate !== undefined ? (body.endDate as string | null) : undefined,
    categoryId: body.categoryId !== undefined ? (body.categoryId as string | null) : undefined,
    shopId: body.shopId !== undefined ? (body.shopId as string | null) : undefined,
  });
  if (!updated) return jsonResponse({ success: false, error: 'Not found' }, 404);
  return jsonResponse({ success: true, data: updated });
}

// DELETE /api/portal/recurring-expenses/[id] — soft-delete the template.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await params;
  const ok = await deleteRecurring(id, auth.organizationId);
  return jsonResponse({ success: ok });
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
