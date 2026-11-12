import { NextRequest, NextResponse } from 'next/server';
import type { VerifiedPayload } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { requireTenantUser } from '@/lib/authorize';
import { customerGet, customerUpdate, customerDelete } from '@/lib/customer-routes.server';

async function caller(request: NextRequest): Promise<VerifiedPayload | Response> {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  return auth;
}

type Ctx = { params: Promise<{ id: string }> };

// GET — one customer: credit sales, payments, balance. PATCH { name?, phone?, notes? }. DELETE — owner only, needs a zero balance.
export async function GET(request: NextRequest, { params }: Ctx) {
  const p = await caller(request);
  return p instanceof Response ? p : customerGet(p, (await params).id);
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const p = await caller(request);
  if (p instanceof Response) return p;
  return customerUpdate(p, (await params).id, (await request.json().catch(() => ({}))) as Record<string, unknown>);
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const p = await caller(request);
  return p instanceof Response ? p : customerDelete(p, (await params).id);
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,DELETE,OPTIONS');
}
