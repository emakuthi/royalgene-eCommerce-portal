import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { convert } from '@/lib/currency-conversion.server';

const CODE_RE = /^[A-Za-z]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/currency/convert — { amount, from, to, date? }. Tenant-scoped (uses
// this workspace's overrides when present).
export async function POST(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = Number(body.amount);
  const from = typeof body.from === 'string' ? body.from.trim().toUpperCase() : '';
  const to = typeof body.to === 'string' ? body.to.trim().toUpperCase() : '';
  const date = typeof body.date === 'string' ? body.date : undefined;

  if (!Number.isFinite(amount)) return jsonResponse({ success: false, error: 'amount must be a number' }, 400);
  if (!CODE_RE.test(from) || !CODE_RE.test(to)) return jsonResponse({ success: false, error: 'Invalid currency code' }, 400);
  if (date && !DATE_RE.test(date)) return jsonResponse({ success: false, error: 'date must be YYYY-MM-DD' }, 400);

  const result = await convert(amount, from, to, { date, organizationId: auth.organizationId });
  if (!result) return jsonResponse({ success: false, error: 'No rate available for this conversion' }, 404);
  return jsonResponse({ success: true, data: result });
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
