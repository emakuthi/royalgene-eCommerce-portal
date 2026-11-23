import { NextRequest } from 'next/server';
import { optionsResponse } from '@/lib/apiResponse';
import { handleDeleteReceipt, handleGetReceipt, handleUpdateReceipt } from '@/lib/receipts/receipt-routes.server';
import { mobileReceiptsAuth } from '@/lib/receipts/mobile-auth.server';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  return handleGetReceipt(auth, (await ctx.params).id);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  return handleUpdateReceipt(request, auth, (await ctx.params).id);
}

// DELETE — removed from RoyalTrack, file moved to the owner's Drive bin.
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  return handleDeleteReceipt(auth, (await ctx.params).id);
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,DELETE,OPTIONS');
}
