import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listRecurring, createRecurring, type Frequency } from '@/lib/recurring-expenses.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token ? verifyToken(token) : null;
}

// GET /api/mobile/recurring-expenses
export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const data = await listRecurring(payload.organizationId);
  return jsonResponse({ success: true, data });
}

// POST /api/mobile/recurring-expenses
export async function POST(request: NextRequest) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await createRecurring(payload.organizationId, {
    shopId: typeof body.shopId === 'string' ? body.shopId : null,
    categoryId: typeof body.categoryId === 'string' ? body.categoryId : null,
    amount: Number(body.amount),
    currency: typeof body.currency === 'string' ? body.currency : undefined,
    description: typeof body.description === 'string' ? body.description : null,
    frequency: typeof body.frequency === 'string' ? (body.frequency as Frequency) : undefined,
    interval: body.interval != null ? Number(body.interval) : undefined,
    startDate: typeof body.startDate === 'string' ? body.startDate : undefined,
    endDate: typeof body.endDate === 'string' ? body.endDate : null,
    createdBy: payload.userId,
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, 400);
  return jsonResponse({ success: true, data: result.recurring });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
