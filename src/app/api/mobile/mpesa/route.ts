import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { isMpesaEnabled } from '@/lib/mpesa-payments.server';

// GET /api/mobile/mpesa — whether this workspace can send M-Pesa prompts (its Paybill/Till keys are set up).
export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  return jsonResponse({ success: true, data: { stkEnabled: await isMpesaEnabled(payload.organizationId) } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
