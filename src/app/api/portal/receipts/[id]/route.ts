import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { optionsResponse } from '@/lib/apiResponse';
import { handleDeleteReceipt, handleGetReceipt, handleUpdateReceipt } from '@/lib/receipts/receipt-routes.server';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return handleGetReceipt(auth, (await ctx.params).id);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return handleUpdateReceipt(request, auth, (await ctx.params).id);
}

// DELETE — hides it here and moves the file to the Drive bin.
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  return handleDeleteReceipt(auth, (await ctx.params).id);
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,DELETE,OPTIONS');
}
