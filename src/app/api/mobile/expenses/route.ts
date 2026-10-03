import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listExpenses, createExpense } from '@/lib/expenses.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token ? verifyToken(token) : null;
}

// GET /api/mobile/expenses[?shopId=&from=&to=&categoryId=]
export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const p = request.nextUrl.searchParams;
  const data = await listExpenses(payload.organizationId, {
    shopId: p.get('shopId') || undefined,
    from: p.get('from') || undefined,
    to: p.get('to') || undefined,
    categoryId: p.get('categoryId') || undefined,
  });
  return jsonResponse({ success: true, data });
}

// POST /api/mobile/expenses
export async function POST(request: NextRequest) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createExpense(payload.organizationId, {
    shopId: typeof body.shopId === 'string' ? body.shopId : null,
    categoryId: typeof body.categoryId === 'string' ? body.categoryId : null,
    amount: Number(body.amount),
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    description: typeof body.description === 'string' ? body.description : null,
    expenseDate: typeof body.expenseDate === 'string' ? body.expenseDate : undefined,
    recordedBy: payload.userId,
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error, code: 'NO_EXCHANGE_RATE' }, 400);
  return jsonResponse({ success: true, data: result.expense });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
