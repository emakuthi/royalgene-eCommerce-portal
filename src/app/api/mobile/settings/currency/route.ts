import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getOrgCurrency, updateOrgCurrency } from '@/lib/currency.server';
import logger from '@/lib/logger';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}

// GET /api/mobile/settings/currency — base currency + manual USD rate for the caller's org.
export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  const data = await getOrgCurrency(payload.organizationId);
  return jsonResponse({ success: true, data });
}

// PUT /api/mobile/settings/currency — { currency?, usdRate?|null }. Workspace owner (admin) only.
export async function PUT(request: NextRequest) {
  try {
    const payload = authed(request);
    if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only the workspace owner can change the currency', code: 'FORBIDDEN' }, 403);
    }

    const body = (await request.json()) as Record<string, unknown>;
    const patch: { currency?: string; usdRate?: number | null } = {};
    if (body.currency !== undefined) {
      if (typeof body.currency !== 'string' || !/^[A-Za-z]{3}$/.test(body.currency.trim())) {
        return jsonResponse({ success: false, error: 'currency must be a 3-letter ISO code', code: 'VALIDATION_ERROR' }, 400);
      }
      patch.currency = body.currency.trim();
    }
    if (body.usdRate !== undefined) {
      if (body.usdRate === null) {
        patch.usdRate = null;
      } else {
        const n = Number(body.usdRate);
        if (!Number.isFinite(n) || n <= 0) {
          return jsonResponse({ success: false, error: 'usdRate must be a positive number or null', code: 'VALIDATION_ERROR' }, 400);
        }
        patch.usdRate = n;
      }
    }
    if (Object.keys(patch).length === 0) {
      return jsonResponse({ success: false, error: 'Nothing to update', code: 'VALIDATION_ERROR' }, 400);
    }

    const data = await updateOrgCurrency(payload.organizationId, patch);
    return jsonResponse({ success: true, data, message: 'Currency updated' });
  } catch (error) {
    logger.error('Mobile currency update error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
