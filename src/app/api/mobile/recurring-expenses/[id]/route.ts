import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { updateRecurring, deleteRecurring } from '@/lib/recurring-expenses.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token ? verifyToken(token) : null;
}

// PATCH /api/mobile/recurring-expenses/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const updated = await updateRecurring(id, payload.organizationId, {
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

// DELETE /api/mobile/recurring-expenses/[id]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const { id } = await params;
  const ok = await deleteRecurring(id, payload.organizationId);
  return jsonResponse({ success: ok });
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
