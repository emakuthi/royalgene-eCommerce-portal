import { NextRequest } from 'next/server';
import type { VerifiedPayload } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { customerPaymentCreate } from '@/lib/customer-routes.server';

async function caller(request: NextRequest): Promise<VerifiedPayload | Response> {
  const auth = await verifyMobileAuth(request);
  if (auth instanceof Response) return auth;
  if (!auth.payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  return auth.payload;
}

type Ctx = { params: Promise<{ id: string }> };

// POST { id?, shopId, amount, method, note?, receivedAt? } — money the customer paid towards what they owe.
export async function POST(request: NextRequest, { params }: Ctx) {
  const p = await caller(request);
  if (p instanceof Response) return p;
  return customerPaymentCreate(p, (await params).id, (await request.json().catch(() => ({}))) as Record<string, unknown>);
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
