import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { hasCapability } from '@/lib/permissions.server';
import { validateBarcodeInputs } from '@/lib/barcode.server';
import logger from '@/lib/logger';

async function productInOrg(productId: string, organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('Product')
    .select('id')
    .eq('id', productId)
    .eq('organizationId', organizationId)
    .maybeSingle();
  return Boolean(data);
}

// GET /api/portal/products/{id}/barcodes — the codes registered for a product.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  const { id } = await context.params;

  if (!(await productInOrg(id, auth.organizationId))) {
    return jsonResponse({ success: false, error: 'Product not found' }, 404);
  }

  const { data, error } = await supabaseAdmin
    .from('ProductBarcode')
    .select('id, code, size, color')
    .eq('productId', id)
    .eq('organizationId', auth.organizationId)
    .order('createdAt', { ascending: true });
  if (error) {
    logger.error('Fetch product barcodes failed', { productId: id, error: error.message });
    return jsonResponse({ success: false, error: 'Failed to load barcodes' }, 500);
  }
  return jsonResponse({ success: true, data: data ?? [] }, 200);
}

// PUT /api/portal/products/{id}/barcodes — { barcodes: [{ code, size?, color? }] } replaces the set.
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  if (!(await hasCapability(auth, 'edit_inventory'))) {
    return jsonResponse({ success: false, error: 'You do not have permission to edit inventory. Ask an admin to grant it.' }, 403);
  }
  const { id } = await context.params;
  const organizationId = auth.organizationId;

  if (!(await productInOrg(id, organizationId))) {
    return jsonResponse({ success: false, error: 'Product not found' }, 404);
  }

  let body: { barcodes?: unknown };
  try {
    body = (await request.json()) as { barcodes?: unknown };
  } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const parsed = validateBarcodeInputs(body?.barcodes);
  if (!parsed.ok) return jsonResponse({ success: false, error: parsed.error }, 400);

  // A code already used by a *different* product in this organization would break
  // scanning, so reject it with a message that names the owner instead of a raw
  // unique-index error.
  if (parsed.barcodes.length > 0) {
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from('ProductBarcode')
      .select('code, productId')
      .eq('organizationId', organizationId)
      .neq('productId', id)
      .in('code', parsed.barcodes.map((b) => b.code));
    if (existingErr) {
      logger.error('Barcode conflict check failed', { productId: id, error: existingErr.message });
      return jsonResponse({ success: false, error: 'Failed to validate barcodes' }, 500);
    }
    const taken = new Set((existing ?? []).map((r) => String((r as { code: string }).code).toLowerCase()));
    const clash = parsed.barcodes.find((b) => taken.has(b.code.toLowerCase()));
    if (clash) {
      return jsonResponse(
        { success: false, error: `Barcode "${clash.code}" is already assigned to another product`, code: 'BARCODE_IN_USE' },
        409,
      );
    }
  }

  // Replace the set: remove this product's codes, then insert the new list.
  const { error: delErr } = await supabaseAdmin
    .from('ProductBarcode')
    .delete()
    .eq('productId', id)
    .eq('organizationId', organizationId);
  if (delErr) {
    logger.error('Clear product barcodes failed', { productId: id, error: delErr.message });
    return jsonResponse({ success: false, error: 'Failed to save barcodes' }, 500);
  }

  if (parsed.barcodes.length > 0) {
    const rows = parsed.barcodes.map((b) => ({
      id: uuidv4(),
      organizationId,
      productId: id,
      code: b.code,
      size: b.size,
      color: b.color,
    }));
    const { error: insErr } = await supabaseAdmin.from('ProductBarcode').insert(rows);
    if (insErr) {
      logger.error('Insert product barcodes failed', { productId: id, error: insErr.message });
      // 23505 = unique violation: a concurrent request claimed one of the codes.
      const status = (insErr as { code?: string }).code === '23505' ? 409 : 500;
      return jsonResponse(
        { success: false, error: status === 409 ? 'One of those barcodes was just assigned to another product' : 'Failed to save barcodes' },
        status,
      );
    }
  }

  return jsonResponse({ success: true, data: parsed.barcodes }, 200);
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
