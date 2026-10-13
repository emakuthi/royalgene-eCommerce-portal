import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { verifyMobileAuth } from '@/lib/mobile-shop-auth';
import { hasCapability } from '@/lib/permissions.server';
import { recipeResponse } from '@/lib/recipes.server';

// GET /api/mobile/products/{productId}/recipe — a menu item's ingredients.
export async function GET(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await verifyMobileAuth(request);
  if (auth instanceof Response) return auth;
  const orgId = auth.payload.organizationId;
  if (!orgId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  const { productId } = await context.params;
  return recipeResponse(orgId, productId, 'GET');
}

// PUT /api/mobile/products/{productId}/recipe — { items: [{ ingredientProductId, quantity }] } replaces it.
export async function PUT(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  const auth = await verifyMobileAuth(request);
  if (auth instanceof Response) return auth;
  const orgId = auth.payload.organizationId;
  if (!orgId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  if (!(await hasCapability(auth.payload, 'edit_inventory'))) {
    return jsonResponse({ success: false, error: 'You do not have permission to edit inventory. Ask an admin to grant it.', code: 'FORBIDDEN' }, 403);
  }
  const { productId } = await context.params;
  return recipeResponse(orgId, productId, 'PUT', request);
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
