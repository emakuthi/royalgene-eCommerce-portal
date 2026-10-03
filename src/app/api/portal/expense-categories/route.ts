import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getCategories, createCategory } from '@/lib/expenses.server';

// GET /api/portal/expense-categories[?activeOnly=1]
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const activeOnly = request.nextUrl.searchParams.get('activeOnly') === '1';
  return jsonResponse({ success: true, data: await getCategories(auth.organizationId, { activeOnly }) });
}

// POST /api/portal/expense-categories — { name }
export async function POST(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return jsonResponse({ success: false, error: 'name is required' }, 400);
  const data = await createCategory(auth.organizationId, name);
  if (!data) return jsonResponse({ success: false, error: 'Failed to create category (duplicate?)' }, 400);
  return jsonResponse({ success: true, data });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
