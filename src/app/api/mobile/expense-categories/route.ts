import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getCategories, createCategory } from '@/lib/expenses.server';

function authed(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  return token ? verifyToken(token) : null;
}

export async function GET(request: NextRequest) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const activeOnly = request.nextUrl.searchParams.get('activeOnly') === '1';
  return jsonResponse({ success: true, data: await getCategories(payload.organizationId, { activeOnly }) });
}

export async function POST(request: NextRequest) {
  const payload = authed(request);
  if (!payload?.organizationId) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return jsonResponse({ success: false, error: 'name is required', code: 'VALIDATION_ERROR' }, 400);
  const data = await createCategory(payload.organizationId, name);
  if (!data) return jsonResponse({ success: false, error: 'Failed to create category' }, 400);
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
