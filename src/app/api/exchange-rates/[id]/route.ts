import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { updateOverride } from '@/lib/exchange-rates.server';

// PUT /api/exchange-rates/{id} — update a manual override's rate (admin, own tenant only).
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization on this account' }, 400);

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const rate = Number(body.rate);
  if (!Number.isFinite(rate) || rate <= 0) return jsonResponse({ success: false, error: 'rate must be a positive number' }, 400);

  const data = await updateOverride(id, auth.organizationId, rate, auth.userId);
  if (!data) return jsonResponse({ success: false, error: 'Override not found for this workspace' }, 404);
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('PUT,OPTIONS');
}
