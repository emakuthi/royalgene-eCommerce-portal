/**
 * Turns a raw activity_logs row into something a person can read: a one-line
 * summary ("Sent 5 × Mira short to Westlands — waiting for approval") and a
 * list of labelled fields for the detail view. Ids in `details` (shops,
 * products, transfers) are shown as names, looked up once per page by the
 * caller — see GET /api/mobile/activity.
 */

export interface ActivityField { label: string; value: string }
export interface ActivityDescription { summary: string | null; fields: ActivityField[] }

export interface TransferFacts {
  productId?: string | null;
  quantity?: number | null;
  fromShopId?: string | null;
  toShopId?: string | null;
  notes?: string | null;
}

export interface ActivityLookups {
  shopNames: Map<string, string>;
  productNames: Map<string, string>;
  /** StockTransfer rows by id, for older log rows that only kept the transfer id. */
  transfers: Map<string, TransferFacts>;
}

export interface ActivityRowLike {
  action: string;
  details?: Record<string, unknown> | null;
  shop_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
}

/** Folded into every app event (see the app's ActivityTracker) and already shown as the device. */
const DEVICE_KEYS = new Set(['deviceName', 'platform']);
/** Ids shown through their names, or not at all. */
const ID_KEYS = new Set(['productId', 'fromShopId', 'toShopId', 'transferId', 'shopStockId', 'shopId', 'saleId', 'saleGroupId']);

const LABELS: Record<string, string> = {
  name: 'Product',
  price: 'Price',
  costPrice: 'Cost price',
  items: 'Items',
  amount: 'Total',
  paymentMethod: 'Paid by',
  quantity: 'Quantity',
  initialQuantity: 'Starting quantity',
  notes: 'Notes',
  reason: 'Reason',
  error: 'Error',
  method: 'Method',
  toShopName: 'To',
  sku: 'SKU',
  category: 'Category',
  unit: 'Unit',
  count: 'Count',
};

const TRANSFER_ACTIONS = new Set(['stock.transfer', 'stock.transfer.confirm', 'stock.transfer.reject', 'stock.transfer.cancel']);

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function formatNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** "costPrice" → "Cost price", "low_stock" → "Low stock". */
export function humanizeKey(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function formatValue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return formatNumber(v);
  if (typeof v === 'string') return v.trim() || null;
  return null; // objects/arrays only through the dedicated handlers below
}

/** [{size:'M', color:'Red', quantity:2}] → "M / Red × 2". */
function formatVariants(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const parts = v.map((c) => {
    const cell = (c ?? {}) as Record<string, unknown>;
    const label = [str(cell.size), str(cell.color)].filter(Boolean).join(' / ') || 'One size';
    const q = num(cell.quantity);
    return q === null ? label : `${label} × ${formatNumber(q)}`;
  });
  return parts.join(', ');
}

/** The ids a page of rows needs names for. */
export function activityLookupIds(rows: ActivityRowLike[]): { shopIds: string[]; productIds: string[]; transferIds: string[] } {
  const shopIds = new Set<string>();
  const productIds = new Set<string>();
  const transferIds = new Set<string>();
  for (const row of rows) {
    const d = row.details ?? {};
    if (row.shop_id) shopIds.add(row.shop_id);
    for (const k of ['fromShopId', 'toShopId'] as const) { const id = str(d[k]); if (id) shopIds.add(id); }
    const pid = str(d.productId);
    if (pid) productIds.add(pid);
    if (row.resource_id && row.resource_type?.toLowerCase() === 'product') productIds.add(row.resource_id);
    const tid = str(d.transferId) ?? (row.resource_type === 'StockTransfer' ? row.resource_id ?? null : null);
    if (tid && TRANSFER_ACTIONS.has(row.action)) transferIds.add(tid);
  }
  return { shopIds: [...shopIds], productIds: [...productIds], transferIds: [...transferIds] };
}

function transferFacts(row: ActivityRowLike, lookups: ActivityLookups): TransferFacts {
  const d = row.details ?? {};
  const tid = str(d.transferId) ?? (row.resource_type === 'StockTransfer' ? row.resource_id ?? null : null);
  const stored = tid ? lookups.transfers.get(tid) : undefined;
  return {
    productId: str(d.productId) ?? stored?.productId ?? null,
    quantity: num(d.quantity) ?? stored?.quantity ?? null,
    fromShopId: str(d.fromShopId) ?? stored?.fromShopId ?? null,
    toShopId: str(d.toShopId) ?? stored?.toShopId ?? null,
    notes: str(d.notes) ?? stored?.notes ?? null,
  };
}

function describeTransfer(row: ActivityRowLike, lookups: ActivityLookups): ActivityDescription {
  const d = row.details ?? {};
  const t = transferFacts(row, lookups);
  const product = str(d.productName) ?? (t.productId ? lookups.productNames.get(t.productId) : undefined) ?? 'stock';
  const from = str(d.fromShopName) ?? (t.fromShopId ? lookups.shopNames.get(t.fromShopId) : undefined) ?? null;
  const to = str(d.toShopName) ?? (t.toShopId ? lookups.shopNames.get(t.toShopId) : undefined) ?? null;
  const what = t.quantity !== null && t.quantity !== undefined ? `${formatNumber(t.quantity)} × ${product}` : product;

  let summary: string;
  switch (row.action) {
    case 'stock.transfer.confirm':
      summary = `Approved ${what}${from ? ` from ${from}` : ''}${to ? ` into ${to}` : ''}`;
      break;
    case 'stock.transfer.reject':
      summary = `Rejected ${what}${from ? ` from ${from}` : ''} — sent back`;
      break;
    case 'stock.transfer.cancel':
      summary = `Cancelled sending ${what}${to ? ` to ${to}` : ''} — back in stock`;
      break;
    default:
      summary = `Sent ${what}${to ? ` to ${to}` : ''} — waiting for approval`;
  }

  const fields: ActivityField[] = [];
  if (product !== 'stock') fields.push({ label: 'Product', value: product });
  if (t.quantity !== null && t.quantity !== undefined) fields.push({ label: 'Quantity', value: formatNumber(t.quantity) });
  const variants = formatVariants(d.variants);
  if (variants) fields.push({ label: 'Sizes / colours', value: variants });
  if (from) fields.push({ label: 'From', value: from });
  if (to) fields.push({ label: 'To', value: to });
  if (t.notes) fields.push({ label: 'Notes', value: t.notes });
  const reason = str(d.reason);
  if (reason) fields.push({ label: 'Reason', value: reason });
  return { summary, fields };
}

/** product.update rows carry `changes: [{field, from, to}]`. */
function changeFields(changes: unknown): ActivityField[] {
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((c) => {
    const ch = (c ?? {}) as Record<string, unknown>;
    const field = str(ch.field);
    if (!field) return [];
    const from = formatValue(ch.from) ?? '—';
    const to = formatValue(ch.to) ?? '—';
    return [{ label: humanizeKey(field === 'name' ? 'productName' : field), value: `${from} → ${to}` }];
  });
}

export function describeActivity(row: ActivityRowLike, lookups: ActivityLookups): ActivityDescription {
  if (TRANSFER_ACTIONS.has(row.action)) return describeTransfer(row, lookups);

  const d = row.details ?? {};
  const fields: ActivityField[] = [];
  const productName = str(d.name) ?? str(d.productName)
    ?? (row.resource_type?.toLowerCase() === 'product' && row.resource_id ? lookups.productNames.get(row.resource_id) : undefined)
    ?? (str(d.productId) ? lookups.productNames.get(str(d.productId)!) : undefined)
    ?? null;
  if (productName && row.action.startsWith('product.')) fields.push({ label: 'Product', value: productName });

  fields.push(...changeFields(d.changes));
  const variants = formatVariants(d.variants);

  for (const [key, value] of Object.entries(d)) {
    if (DEVICE_KEYS.has(key) || ID_KEYS.has(key) || key === 'changes' || key === 'variants') continue;
    if ((key === 'name' || key === 'productName') && row.action.startsWith('product.')) continue;
    if (key === 'offline') continue; // every app sale is saved on the phone first
    const v = formatValue(value);
    if (v !== null) fields.push({ label: humanizeKey(key), value: v });
  }
  if (variants) fields.push({ label: 'Sizes / colours', value: variants });

  const shopName = row.shop_id ? lookups.shopNames.get(row.shop_id) : undefined;
  if (shopName) fields.push({ label: 'Shop', value: shopName });

  return { summary: summarize(row, d, fields, productName), fields };
}

function summarize(row: ActivityRowLike, d: Record<string, unknown>, fields: ActivityField[], productName: string | null): string | null {
  if (row.action === 'sale.record' || row.action === 'sale.create') {
    const items = num(d.items);
    const amount = num(d.amount);
    const pay = str(d.paymentMethod);
    const parts = [
      items !== null ? `${formatNumber(items)} item${items === 1 ? '' : 's'}` : null,
      amount !== null ? `total ${formatNumber(amount)}` : null,
      pay ? `paid by ${pay}` : null,
    ].filter(Boolean);
    if (str(d.error)) return `Not saved: ${str(d.error)}`;
    return parts.length ? capitalize(parts.join(', ')) : null;
  }
  if (row.action === 'product.update') {
    const changed = changeFields(d.changes).map((f) => f.label.toLowerCase());
    if (productName && changed.length) return `${productName}: changed ${changed.join(', ')}`;
    return productName;
  }
  if (row.action.startsWith('product.')) return productName;
  const reason = str(d.reason) ?? str(d.error);
  if (reason) return reason;
  const shown = fields.filter((f) => f.label !== 'Shop').slice(0, 2);
  return shown.length ? shown.map((f) => `${f.label}: ${f.value}`).join(' · ') : null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
