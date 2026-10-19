import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getStkPayment } from '@/lib/mpesa-payments.server';

// GET /api/mobile/mpesa/stk/[id] — where an M-Pesa prompt stands: pending, success (with the receipt), failed or cancelled.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const { id } = await params;
  const payment = await getStkPayment(payload.organizationId, id);
  if (!payment) return jsonResponse({ success: false, error: 'Payment not found' }, 404);
  return jsonResponse({ success: true, data: payment });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
