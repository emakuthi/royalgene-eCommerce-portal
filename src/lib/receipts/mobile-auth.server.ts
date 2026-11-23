import 'server-only';
import type { NextRequest } from 'next/server';
import { verifyToken, type VerifiedPayload } from '../auth.server';
import { jsonResponse } from '../apiResponse';
import { rejectIfDeactivated } from '../deactivated-staff.server';

/** The app's Bearer token for /api/mobile/receipts/*: the payload, or the error response to send back. */
export async function mobileReceiptsAuth(request: NextRequest): Promise<VerifiedPayload | Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const deactivated = await rejectIfDeactivated(payload);
  if (deactivated) return deactivated;
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  return payload;
}
