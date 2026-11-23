import { NextRequest } from 'next/server';
import { optionsResponse } from '@/lib/apiResponse';
import { handleReceiptFile } from '@/lib/receipts/receipt-routes.server';
import { mobileReceiptsAuth } from '@/lib/receipts/mobile-auth.server';

// GET /api/mobile/receipts/:id/file[?download=1] — the receipt image/PDF, fetched from Google Drive.
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  return handleReceiptFile(auth, (await ctx.params).id, request.nextUrl.searchParams.get('download') === '1');
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
