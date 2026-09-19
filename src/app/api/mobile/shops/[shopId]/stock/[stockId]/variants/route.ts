import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';
import { verifyMobileShopAccess } from '@/lib/mobile-shop-auth';
import { getVariantMatrix, setVariantMatrix, type VariantCellInput, type VariantMatrix } from '@/lib/variant-stock.server';
import { canViewCostData } from '@/lib/cost-visibility.server';
import { hasCapability } from '@/lib/permissions.server';

/** Cost is owner-only (see cost-visibility.server.ts) — same rule as the product's own costPrice. */
function redactMatrixCost(matrix: VariantMatrix): VariantMatrix {
  return { ...matrix, cells: matrix.cells.map((c) => ({ ...c, costPrice: null })) };
}

// Size × colour matrix for one ShopStock row (mobile).
//   GET -> matrix + rollups
//   PUT { cells: [{ size, color, quantity }], version? } -> replace the matrix
//
// Optional `version` on PUT enables optimistic concurrency: pass the
// ShopStock version you last read and the replace only applies if nobody
// else has changed this stock row since — otherwise a 409 VERSION_CONFLICT
// comes back with the current matrix instead of silently overwriting
// someone else's edit. Omit it to keep the old unconditional-replace
// behaviour.

async function loadStock(request: NextRequest, shopId: string, stockId: string) {
  const auth = await verifyMobileShopAccess(request, shopId);
  if (auth instanceof Response) return { error: auth };

  const { data: stock } = await supabaseAdmin
    .from('ShopStock')
    .select('id, shopId, organizationId, productId, quantity, version')
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

  const rawMatrix = await getVariantMatrix(stockId);
  const matrix = (await canViewCostData(res.auth.payload)) ? rawMatrix : redactMatrixCost(rawMatrix);
  return jsonResponse({ success: true, data: { ...matrix, shopStockId: stockId, flatQuantity: res.stock.quantity } });
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ shopId: string; stockId: string }> }) {
  const { shopId, stockId } = await ctx.params;
  const res = await loadStock(request, shopId, stockId);
  if ('error' in res) return res.error;
  const { stock, auth } = res;

  if (!(await hasCapability(auth.payload, 'edit_inventory'))) {
    return jsonResponse(
      { success: false, error: 'You do not have permission to edit inventory. Ask an admin to grant it.', code: 'FORBIDDEN' },
      403,
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, 400); }
  const { cells: rawCells, version } = body as { cells?: unknown; version?: unknown };
  if (!Array.isArray(rawCells)) return jsonResponse({ success: false, error: 'cells[] is required', code: 'VALIDATION_ERROR' }, 400);
  const clientVersion = typeof version === 'number' ? version : undefined;

  // Cost price is owner-level (see cost-visibility.server.ts) — a caller
  // without the capability can't set a per-cell cost either.
  const canSetCostPrice = await canViewCostData(auth.payload);
  let productPrice: number | null = null;
  if (canSetCostPrice && stock.productId) {
    const { data: product } = await supabaseAdmin.from('Product').select('price').eq('id', stock.productId).maybeSingle();
    productPrice = typeof product?.price === 'number' ? product.price : null;
  }

  const cells: VariantCellInput[] = [];
  for (const c of rawCells) {
    if (typeof c !== 'object' || c === null) continue;
    const cell = c as Record<string, unknown>;
    const q = Number(cell.quantity);
    if (!Number.isFinite(q) || q < 0) return jsonResponse({ success: false, error: 'Each cell needs a quantity >= 0', code: 'VALIDATION_ERROR' }, 400);
    const cellPrice = typeof cell.price === 'number' ? cell.price : null;
    const cellCostPrice = canSetCostPrice && typeof cell.costPrice === 'number' ? cell.costPrice : null;
    if (cellCostPrice != null) {
      const ceiling = cellPrice ?? productPrice;
      if (typeof ceiling === 'number' && cellCostPrice >= ceiling) {
        return jsonResponse({ success: false, error: 'Cost price must be less than the selling price', code: 'VALIDATION_ERROR' }, 400);
      }
    }
    cells.push({
      size: typeof cell.size === 'string' ? cell.size : '',
      color: typeof cell.color === 'string' ? cell.color : '',
      quantity: q,
      price: cellPrice,
      costPrice: cellCostPrice,
    });
  }

  try {
    // Optimistic concurrency: atomically claim the ShopStock row by
    // conditionally touching it (fires the sync_touch trigger, which bumps
    // version) — same compare-and-swap gate as the flat-quantity PUT route,
    // just guarding a multi-row matrix replace instead of a single UPDATE.
    if (clientVersion !== undefined) {
      const { data: claimed, error: claimError } = await supabaseAdmin
        .from('ShopStock')
        .update({ updatedAt: new Date().toISOString() })
        .eq('id', stockId)
        .eq('version', clientVersion)
        .select('id, version');

      if (claimError) {
        return jsonResponse({ success: false, error: 'Failed to save breakdown', code: 'INTERNAL_ERROR' }, 500);
      }

      if (!claimed || claimed.length === 0) {
        const [{ data: current }, currentMatrix, showCost] = await Promise.all([
          supabaseAdmin.from('ShopStock').select('id, version, quantity').eq('id', stockId).maybeSingle(),
          getVariantMatrix(stockId),
          canViewCostData(auth.payload),
        ]);
        return jsonResponse({
          success: false,
          error: 'This stock breakdown was changed elsewhere since you last loaded it.',
          code: 'VERSION_CONFLICT',
          data: { ...(showCost ? currentMatrix : redactMatrixCost(currentMatrix)), shopStockId: stockId, version: current?.version },
        }, 409);
      }
    }

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

    // The rollup trigger (ShopStockVariant -> ShopStock.quantity) already
    // bumped ShopStock.version again during setVariantMatrix above, so
    // re-read it fresh rather than reusing the pre-replace `stock.version`.
    const { data: freshStock } = await supabaseAdmin.from('ShopStock').select('version').eq('id', stockId).maybeSingle();

    const respMatrix = (await canViewCostData(auth.payload)) ? matrix : redactMatrixCost(matrix);
    return jsonResponse({ success: true, data: { ...respMatrix, shopStockId: stockId, version: freshStock?.version } });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to save breakdown', code: 'INTERNAL_ERROR' }, 500);
  }
}
