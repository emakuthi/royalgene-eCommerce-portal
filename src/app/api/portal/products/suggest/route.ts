import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { suggestProducts } from '@/lib/product-suggest.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

/** GET ?q=…&shopId=… — existing products to suggest while typing a new product's name or SKU. */
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: true, data: [] }, 200);

  const params = new URL(request.url).searchParams;
  const data = await suggestProducts({ organizationId: auth.organizationId, query: params.get('q') ?? '', shopId: params.get('shopId') });
  return jsonResponse({ success: true, data }, 200);
}

export async function OPTIONS() {
  return optionsResponse();
}
