import { NextRequest, NextResponse } from 'next/server';
import { requireRole, requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { businessSettingsGet, businessSettingsPut } from '@/lib/business-routes.server';

// GET /api/portal/business — business type, option names, categories, units.
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  return businessSettingsGet(auth.organizationId);
}

// PUT /api/portal/business — { businessType?, option1Label?, option2Label? }. Owner only.
export async function PUT(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  return businessSettingsPut(auth.organizationId, request);
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
