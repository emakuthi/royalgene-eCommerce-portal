import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { optionsResponse } from '@/lib/apiResponse';
import { handleReceiptFile } from '@/lib/receipts/receipt-routes.server';

// GET /api/portal/receipts/:id/file[?download=1] — the receipt image/PDF, fetched from Google Drive.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return handleReceiptFile(auth, (await ctx.params).id, request.nextUrl.searchParams.get('download') === '1');
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
