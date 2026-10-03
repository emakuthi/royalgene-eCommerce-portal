import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listExpenses, createExpense } from '@/lib/expenses.server';

// GET /api/portal/expenses[?shopId=&from=&to=&categoryId=]
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const p = request.nextUrl.searchParams;
  const data = await listExpenses(auth.organizationId, {
    shopId: p.get('shopId') || undefined,
    from: p.get('from') || undefined,
    to: p.get('to') || undefined,
    categoryId: p.get('categoryId') || undefined,
  });
  return jsonResponse({ success: true, data });
}

// POST /api/portal/expenses — { amount, currency?, categoryId?, shopId?, description?, expenseDate? }
export async function POST(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createExpense(auth.organizationId, {
    shopId: typeof body.shopId === 'string' ? body.shopId : null,
    categoryId: typeof body.categoryId === 'string' ? body.categoryId : null,
    amount: Number(body.amount),
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    description: typeof body.description === 'string' ? body.description : null,
    expenseDate: typeof body.expenseDate === 'string' ? body.expenseDate : undefined,
    recordedBy: auth.userId,
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, 400);
  return jsonResponse({ success: true, data: result.expense });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
