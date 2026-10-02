import 'server-only';
import { supabaseAdmin } from './supabase-client';

/**
 * A single entry in a product's history timeline. Assembled from three
 * sources so testers/admins can see the full life of a product:
 *   1. Product.createdAt         → the "created" event (+ initial stock)
 *   2. StockTransaction (ledger) → every quantity movement (sale, restock,
 *      adjustment, transfer) with a computed before→after and who did it
 *   3. activity_logs (product.*) → non-stock field edits (name/price/cost/…)
 *      recorded going forward on the edit routes
 */
export type ProductHistoryType =
  | 'created'
  | 'sale'
  | 'restock'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'edit'
  | 'stock_change';

export interface ProductHistoryChange {
  field: string;
  from: string | null;
  to: string | null;
}

export interface ProductHistoryEvent {
  id: string;
  type: ProductHistoryType;
  timestamp: string; // ISO
  title: string;
  actorName: string | null;
  shopName: string | null;
  quantityDelta: number | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  reference: string | null;
  note: string | null;
  changes: ProductHistoryChange[] | null;
}

function variantSuffix(size?: unknown, color?: unknown): string {
  const parts = [size, color].filter((v) => typeof v === 'string' && v.trim().length > 0) as string[];
  return parts.length ? ` (${parts.join(' / ')})` : '';
}

/**
 * Build the merged, newest-first history for a single product within an
 * organization. Returns null if the product doesn't exist in that org.
 */
export async function buildProductHistory(
  organizationId: string,
  productId: string,
): Promise<ProductHistoryEvent[] | null> {
  const { data: product } = await supabaseAdmin
    .from('Product')
    .select('id, name, createdAt, organizationId')
    .eq('id', productId)
    .eq('organizationId', organizationId)
    .maybeSingle();
  if (!product) return null;

  // All shop stocks for this product in the org (current quantities anchor the
  // running-balance walk; transactions only store signed deltas).
  const { data: shopStocks } = await supabaseAdmin
    .from('ShopStock')
    .select('id, shopId, quantity')
    .eq('productId', productId)
    .eq('organizationId', organizationId);
  const stockRows = shopStocks ?? [];
  const shopStockIds = stockRows.map((s) => s.id as string);
  const currentQtyByStock = new Map<string, number>(stockRows.map((s) => [s.id as string, Number(s.quantity) || 0]));

  // Shop names
  const shopIds = [...new Set(stockRows.map((s) => s.shopId as string).filter(Boolean))];
  const shopNameById = new Map<string, string>();
  if (shopIds.length) {
    const { data: shops } = await supabaseAdmin.from('Shop').select('id, name').in('id', shopIds);
    (shops ?? []).forEach((s) => shopNameById.set(s.id as string, (s.name as string) ?? ''));
  }

  // Ledger transactions for those stocks, oldest first
  const txns = shopStockIds.length
    ? ((await supabaseAdmin
        .from('StockTransaction')
        .select('id, shopStockId, portalUserId, type, quantity, reason, reference, notes, size, color, createdAt')
        .in('shopStockId', shopStockIds)
        .order('createdAt', { ascending: true })
      ).data ?? [])
    : [];

  // Forward-logged field edits / creation actor
  const { data: activities } = await supabaseAdmin
    .from('activity_logs')
    .select('id, user_id, action, details, created_at')
    .eq('organization_id', organizationId)
    .eq('resource_type', 'product')
    .eq('resource_id', productId)
    .order('created_at', { ascending: true });
  const activityRows = activities ?? [];

  // ── Resolve actor names (PortalUser.id → User.name, and activity user_id → User.name) ──
  const portalUserIds = [...new Set(txns.map((t) => t.portalUserId as string).filter(Boolean))];
  const activityUserIds = [...new Set(activityRows.map((a) => a.user_id as string).filter(Boolean))];
  const nameByPortalUser = new Map<string, string>();
  const nameByUser = new Map<string, string>();
  if (portalUserIds.length) {
    const { data: pus } = await supabaseAdmin.from('PortalUser').select('id, userId').in('id', portalUserIds);
    const userIds = [...new Set((pus ?? []).map((p) => p.userId as string).filter(Boolean))];
    const { data: users } = userIds.length
      ? await supabaseAdmin.from('User').select('id, name, email').in('id', userIds)
      : { data: [] as Array<Record<string, unknown>> };
    const nm = new Map<string, string>();
    (users ?? []).forEach((u) => nm.set(u.id as string, ((u.name as string) || (u.email as string) || '') as string));
    (pus ?? []).forEach((p) => nameByPortalUser.set(p.id as string, nm.get(p.userId as string) ?? ''));
  }
  if (activityUserIds.length) {
    const { data: users } = await supabaseAdmin.from('User').select('id, name, email').in('id', activityUserIds);
    (users ?? []).forEach((u) => nameByUser.set(u.id as string, ((u.name as string) || (u.email as string) || '') as string));
  }

  // ── Running balance per shop stock: walk each stock's txns newest→oldest,
  //    anchored on the current quantity, so before/after always reconcile to
  //    the live value even if the initial stock was never a ledger row. ──
  const beforeAfter = new Map<string, { before: number; after: number }>();
  const byStock = new Map<string, typeof txns>();
  for (const t of txns) {
    const arr = byStock.get(t.shopStockId as string) ?? [];
    arr.push(t);
    byStock.set(t.shopStockId as string, arr);
  }
  const initialByStock = new Map<string, number>();
  for (const [stockId, arr] of byStock) {
    let cursor = currentQtyByStock.get(stockId) ?? 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const delta = Number(arr[i].quantity) || 0;
      const after = cursor;
      const before = after - delta;
      beforeAfter.set(arr[i].id as string, { before, after });
      cursor = before;
    }
    initialByStock.set(stockId, cursor); // stock level before the first recorded txn
  }
  // Stocks with no transactions: their current quantity is the initial.
  for (const [stockId, qty] of currentQtyByStock) {
    if (!initialByStock.has(stockId)) initialByStock.set(stockId, qty);
  }
  const initialTotal = [...initialByStock.values()].reduce((a, b) => a + b, 0);

  const events: ProductHistoryEvent[] = [];

  // Creation event — actor comes from a product.create activity if we have one.
  const createActivity = activityRows.find((a) => a.action === 'product.create');
  events.push({
    id: `created-${product.id}`,
    type: 'created',
    timestamp: (createActivity?.created_at as string) ?? (product.createdAt as string),
    title: 'Product created',
    actorName: createActivity ? (nameByUser.get(createActivity.user_id as string) || null) : null,
    shopName: null,
    quantityDelta: null,
    quantityBefore: null,
    quantityAfter: initialTotal,
    reference: null,
    note: `Initial stock: ${initialTotal}`,
    changes: null,
  });

  // Stock ledger events
  for (const t of txns) {
    const delta = Number(t.quantity) || 0;
    const ba = beforeAfter.get(t.id as string) ?? { before: 0, after: 0 };
    const reason = ((t.reason as string) || '').toLowerCase();
    const type = ((t.type as string) || '').toLowerCase();
    const vsuffix = variantSuffix(t.size, t.color);
    let evType: ProductHistoryType = 'stock_change';
    let title: string;
    if (reason.includes('sale') || (type === 'subtract' && t.reference)) {
      evType = 'sale';
      title = `Sold ${Math.abs(delta)}${vsuffix}`;
    } else if (reason.includes('transfer')) {
      evType = delta < 0 ? 'transfer_out' : 'transfer_in';
      title = `${delta < 0 ? 'Transferred out' : 'Transferred in'} ${Math.abs(delta)}${vsuffix}`;
    } else if (type === 'add' || (delta > 0 && (reason.includes('restock') || reason.includes('add')))) {
      evType = 'restock';
      title = `Restocked +${Math.abs(delta)}${vsuffix}`;
    } else if (type === 'adjustment' || reason.includes('adjust')) {
      evType = 'adjustment';
      title = `Stock adjusted ${delta >= 0 ? '+' : ''}${delta}${vsuffix}`;
    } else {
      title = `Stock ${delta >= 0 ? 'increased' : 'decreased'} ${delta >= 0 ? '+' : ''}${delta}${vsuffix}`;
    }
    events.push({
      id: t.id as string,
      type: evType,
      timestamp: t.createdAt as string,
      title,
      actorName: nameByPortalUser.get(t.portalUserId as string) || null,
      shopName: shopNameById.get((stockRows.find((s) => s.id === t.shopStockId)?.shopId as string) ?? '') || null,
      quantityDelta: delta,
      quantityBefore: ba.before,
      quantityAfter: ba.after,
      reference: (t.reference as string) || null,
      note: (t.notes as string) || (t.reason as string) || null,
      changes: null,
    });
  }

  // Field-edit events
  for (const a of activityRows) {
    if (a.action !== 'product.update') continue;
    const details = (a.details ?? {}) as Record<string, unknown>;
    const rawChanges = Array.isArray(details.changes) ? (details.changes as Array<Record<string, unknown>>) : [];
    const changes: ProductHistoryChange[] = rawChanges.map((c) => ({
      field: String(c.field ?? ''),
      from: c.from === undefined || c.from === null ? null : String(c.from),
      to: c.to === undefined || c.to === null ? null : String(c.to),
    }));
    if (!changes.length) continue;
    events.push({
      id: a.id as string,
      type: 'edit',
      timestamp: a.created_at as string,
      title: changes.length === 1 ? `Updated ${changes[0].field}` : `Updated ${changes.length} fields`,
      actorName: nameByUser.get(a.user_id as string) || null,
      shopName: null,
      quantityDelta: null,
      quantityBefore: null,
      quantityAfter: null,
      reference: null,
      note: null,
      changes,
    });
  }

  // Newest first
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return events;
}
