import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { supabaseAdmin } from '@/lib/supabase-client';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getVariantMatrix, setVariantMatrix, type VariantCellInput, type VariantMatrix } from '@/lib/variant-stock.server';
import { canViewCostData } from '@/lib/cost-visibility.server';

/** Cost is owner-only (see cost-visibility.server.ts) — same rule as the product's own costPrice. */
function redactMatrixCost(matrix: VariantMatrix): VariantMatrix {
  return { ...matrix, cells: matrix.cells.map((c) => ({ ...c, costPrice: null })) };
}

// Size × colour matrix for one ShopStock row.
//   GET  -> the matrix + row/column rollups
//   PUT  { cells: [{ size, color, quantity }] } -> replace the whole matrix
//        The DB trigger rolls SUM(cells) up into ShopStock.quantity.

async function loadStock(request: NextRequest, stockId: string) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return { error: auth };
  const payload = auth;

  const { data: stock, error } = await supabaseAdmin
    .from('ShopStock')
    .select('id, shopId, productId, organizationId, quantity')
    .eq('id', stockId)
    .maybeSingle();
  if (error || !stock) return { error: jsonResponse({ success: false, error: 'Stock not found' }, 404) };

  if (payload.organizationId && stock.organizationId !== payload.organizationId) {
    return { error: jsonResponse({ success: false, error: 'Forbidden' }, 403) };
  }
  if (payload.role !== 'admin' && payload.role !== 'super_admin') {
    const { data: pu } = await supabaseAdmin.from('PortalUser').select('shopId').eq('userId', payload.userId).maybeSingle();
    if (!pu || pu.shopId !== stock.shopId) {
      return { error: jsonResponse({ success: false, error: 'Forbidden' }, 403) };
    }
  }
  return { stock, payload };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await loadStock(request, id);
  if ('error' in res) return res.error;

  const rawMatrix = await getVariantMatrix(id);
  const matrix = (await canViewCostData(res.payload)) ? rawMatrix : redactMatrixCost(rawMatrix);
  return jsonResponse({ success: true, data: { ...matrix, shopStockId: id, flatQuantity: res.stock.quantity } });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await loadStock(request, id);
  if ('error' in res) return res.error;
  const { stock, payload } = res;

  let body: unknown;
  try { body = await request.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const rawCells = (body as { cells?: unknown })?.cells;
  if (!Array.isArray(rawCells)) return jsonResponse({ success: false, error: 'cells[] is required' }, 400);

  const cells: VariantCellInput[] = [];
  for (const c of rawCells) {
    if (typeof c !== 'object' || c === null) continue;
    const cell = c as Record<string, unknown>;
    const q = Number(cell.quantity);
    if (!Number.isFinite(q) || q < 0) return jsonResponse({ success: false, error: 'Each cell needs a quantity >= 0' }, 400);
    cells.push({
      size: typeof cell.size === 'string' ? cell.size : '',
      color: typeof cell.color === 'string' ? cell.color : '',
      quantity: q,
      price: typeof cell.price === 'number' ? cell.price : null,
      costPrice: typeof cell.costPrice === 'number' ? cell.costPrice : null,
    });
  }

  try {
    const before = await getVariantMatrix(id);
    const matrix = await setVariantMatrix(id, stock.organizationId ?? null, cells);

    // Audit the net change against the flat total.
    const portalUserId = payload.role === 'admin' || payload.role === 'super_admin'
      ? `admin-${payload.userId}`
      : payload.userId;
    await supabaseAdmin.from('StockTransaction').insert([{
      id: uuidv4(),
      organizationId: stock.organizationId,
      shopStockId: id,
      portalUserId,
      type: 'adjustment',
      quantity: matrix.total - before.total,
      reason: 'Size/colour breakdown updated',
      createdAt: new Date().toISOString(),
    }]);

    const respMatrix = (await canViewCostData(payload)) ? matrix : redactMatrixCost(matrix);
    return jsonResponse({ success: true, data: { ...respMatrix, shopStockId: id } });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to save breakdown' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,OPTIONS');
}
