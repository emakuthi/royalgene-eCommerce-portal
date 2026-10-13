import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { businessSettingsGet, businessSettingsPut } from '@/lib/business-routes.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  return verifyToken(token);
}

// GET /api/mobile/settings/business — business type, option names, categories, units.
export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  return businessSettingsGet(payload.organizationId);
}

// PUT /api/mobile/settings/business — { businessType?, option1Label?, option2Label? }. Workspace owner only.
export async function PUT(request: NextRequest) {
  const payload = authed(request);
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  if (payload.role !== 'admin' && payload.role !== 'super_admin') {
    return jsonResponse({ success: false, error: 'Only the workspace owner can change this', code: 'FORBIDDEN' }, 403);
  }
  return businessSettingsPut(payload.organizationId, request);
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
