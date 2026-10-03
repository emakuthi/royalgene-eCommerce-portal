import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { updateExpense, deleteExpense } from '@/lib/expenses.server';

// PATCH /api/portal/expenses/{id}
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const data = await updateExpense(id, auth.organizationId, {
    shopId: body.shopId === undefined ? undefined : (typeof body.shopId === 'string' ? body.shopId : null),
    categoryId: body.categoryId === undefined ? undefined : (typeof body.categoryId === 'string' ? body.categoryId : null),
    amount: body.amount === undefined ? undefined : Number(body.amount),
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    description: body.description === undefined ? undefined : (typeof body.description === 'string' ? body.description : null),
    expenseDate: typeof body.expenseDate === 'string' ? body.expenseDate : undefined,
  });
  if (!data) return jsonResponse({ success: false, error: 'Expense not found' }, 404);
  return jsonResponse({ success: true, data });
}

// DELETE /api/portal/expenses/{id} — soft delete
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await context.params;
  const ok = await deleteExpense(id, auth.organizationId);
  return jsonResponse({ success: ok, ...(ok ? {} : { error: 'Delete failed' }) }, ok ? 200 : 500);
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
