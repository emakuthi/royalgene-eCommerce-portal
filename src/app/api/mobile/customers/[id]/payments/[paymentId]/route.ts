import { NextRequest } from 'next/server';
import type { VerifiedPayload } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { customerPaymentDelete } from '@/lib/customer-routes.server';

async function caller(request: NextRequest): Promise<VerifiedPayload | Response> {
  const auth = await verifyMobileAuth(request);
  if (auth instanceof Response) return auth;
  if (!auth.payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  return auth.payload;
}

type Ctx = { params: Promise<{ id: string; paymentId: string }> };

// DELETE — undo a payment recorded by mistake. Owner only.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const p = await caller(request);
  return p instanceof Response ? p : customerPaymentDelete(p, (await params).paymentId);
}

export function OPTIONS() {
  return optionsResponse('DELETE,OPTIONS');
}
