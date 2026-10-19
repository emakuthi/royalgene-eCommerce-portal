import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { startStkPayment } from '@/lib/mpesa-payments.server';
import logger from '@/lib/logger';

// POST /api/mobile/mpesa/stk — { shopId, phone, amount } sends an M-Pesa
// payment prompt to the customer's phone. Poll GET /api/mobile/mpesa/stk/[id]
// for the result.
export async function POST(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const result = await startStkPayment({
      organizationId: payload.organizationId,
      shopId: typeof body.shopId === 'string' ? body.shopId : null,
      requestedBy: payload.userId ?? null,
      phone: typeof body.phone === 'string' ? body.phone : '',
      amount: Number(body.amount),
      description: typeof body.description === 'string' ? body.description : undefined,
    });
    if (!result.ok) return jsonResponse({ success: false, error: result.error, code: result.code }, result.status);
    return jsonResponse({ success: true, data: result.payment, message: result.message });
  } catch (err) {
    logger.error('[mpesa] STK push failed', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Could not start the M-Pesa payment', code: 'STK_FAILED' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
