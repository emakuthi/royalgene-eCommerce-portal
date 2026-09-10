import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { getVariantMatrix, setVariantMatrix, type VariantCellInput } from '@/lib/variant-stock.server';

// Size × colour matrix for one ShopStock row (mobile).
//   GET -> matrix + rollups
//   PUT { cells: [{ size, color, quantity }] } -> replace the matrix

async function loadStock(request: NextRequest, shopId: string, stockId: string) {
  const auth = await verifyMobileShopAccess(request, shopId);
  if (auth instanceof Response) return { error: auth };

  const { data: stock } = await supabaseAdmin
    .from('ShopStock')
    .select('id, shopId, organizationId, quantity')
    .eq('id', stockId)
    .eq('shopId', shopId)
    .maybeSingle();
  if (!stock) return { error: jsonResponse({ success: false, error: 'Stock not found', code: 'NOT_FOUND' }, 404) };
  return { stock, auth };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ shopId: string; stockId: string }> }) {
  const { shopId, stockId } = await ctx.params;
  const res = await loadStock(request, shopId, stockId);
  if ('error' in res) return res.error;

  const matrix = await getVariantMatrix(stockId);
  return jsonResponse({ success: true, data: { ...matrix, shopStockId: stockId, flatQuantity: res.stock.quantity } });
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ shopId: string; stockId: string }> }) {
  const { shopId, stockId } = await ctx.params;
  const res = await loadStock(request, shopId, stockId);
  if ('error' in res) return res.error;
  const { stock, auth } = res;

  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400); }
  const rawCells = (body as { cells?: unknown })?.cells;
  if (!Array.isArray(rawCells)) return jsonResponse({ success: false, error: 'cells[] is required', code: 'VALIDATION_ERROR' }, 400);

  const cells: VariantCellInput[] = [];
  for (const c of rawCells) {
    if (typeof c !== 'object' || c === null) continue;
    const cell = c as Record<string, unknown>;
    const q = Number(cell.quantity);
    if (!Number.isFinite(q) || q < 0) return jsonResponse({ success: false, error: 'Each cell needs a quantity >= 0', code: 'VALIDATION_ERROR' }, 400);
    cells.push({
      size: typeof cell.size === 'string' ? cell.size : '',
      color: typeof cell.color === 'string' ? cell.color : '',
      quantity: q,
    });
  }

  try {
    const before = await getVariantMatrix(stockId);
    const matrix = await setVariantMatrix(stockId, stock.organizationId ?? null, cells);

    await supabaseAdmin.from('StockTransaction').insert([{
      id: uuidv4(),
      organizationId: stock.organizationId,
      shopStockId: stockId,
      portalUserId: auth.portalUserId,
      type: 'adjustment',
      quantity: matrix.total - before.total,
      reason: 'Size/colour breakdown updated',
      createdAt: new Date().toISOString(),
    }]);

    return jsonResponse({ success: true, data: { ...matrix, shopStockId: stockId } });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to save breakdown', code: 'INTERNAL_ERROR' }, 500);
  }
}
