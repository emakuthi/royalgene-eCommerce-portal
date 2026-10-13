import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { hasCapability } from '@/lib/permissions.server';
import { recipeResponse } from '@/lib/recipes.server';

// GET /api/portal/products/{id}/recipe — a menu item's ingredients.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await context.params;
  return recipeResponse(auth.organizationId, id, 'GET');
}

// PUT /api/portal/products/{id}/recipe — { items: [{ ingredientProductId, quantity }] } replaces it.
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  if (!(await hasCapability(auth, 'edit_inventory'))) {
    return jsonResponse({ success: false, error: 'You do not have permission to edit inventory. Ask an admin to grant it.' }, 403);
  }
  const { id } = await context.params;
  return recipeResponse(auth.organizationId, id, 'PUT', request);
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
