import { NextRequest } from 'next/server';
import type { VerifiedPayload } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { customersList, customersCreate } from '@/lib/customer-routes.server';

async function caller(request: NextRequest): Promise<VerifiedPayload | Response> {
  const auth = await verifyMobileAuth(request);
  if (auth instanceof Response) return auth;
  if (!auth.payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  return auth.payload;
}

// GET — customers with what each owes. POST { id?, name, phone?, notes? } — add one (id = client UUID, retry-safe).
export async function GET(request: NextRequest) {
  const p = await caller(request);
  return p instanceof Response ? p : customersList(p);
}

export async function POST(request: NextRequest) {
  const p = await caller(request);
  if (p instanceof Response) return p;
  return customersCreate(p, (await request.json().catch(() => ({}))) as Record<string, unknown>);
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
