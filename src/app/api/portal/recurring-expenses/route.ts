import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listRecurring, createRecurring, type Frequency } from '@/lib/recurring-expenses.server';

// GET /api/portal/recurring-expenses
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const data = await listRecurring(auth.organizationId);
  return jsonResponse({ success: true, data });
}

// POST /api/portal/recurring-expenses
export async function POST(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createRecurring(auth.organizationId, {
    shopId: typeof body.shopId === 'string' ? body.shopId : null,
    categoryId: typeof body.categoryId === 'string' ? body.categoryId : null,
    amount: Number(body.amount),
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    description: typeof body.description === 'string' ? body.description : null,
    frequency: typeof body.frequency === 'string' ? (body.frequency as Frequency) : undefined,
    interval: body.interval != null ? Number(body.interval) : undefined,
    startDate: typeof body.startDate === 'string' ? body.startDate : undefined,
    endDate: typeof body.endDate === 'string' ? body.endDate : null,
    createdBy: auth.userId,
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, 400);
  return jsonResponse({ success: true, data: result.recurring });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
