import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { deleteExpense, expenseScopeFor } from '@/lib/expenses.server';

// DELETE /api/mobile/expenses/{id} — soft delete (mobile token). Staff: only their own.
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const { id } = await context.params;
  const ok = await deleteExpense(id, payload.organizationId, await expenseScopeFor(payload));
  return jsonResponse({ success: ok, ...(ok ? {} : { error: 'Expense not found', code: 'NOT_FOUND' }) }, ok ? 200 : 404);
}

export function OPTIONS() {
  return optionsResponse('DELETE,OPTIONS');
}
