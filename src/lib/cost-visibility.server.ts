import 'server-only';
import type { VerifiedPayload } from './auth.server';
import { hasCapability } from './permissions.server';

/**
 * Cost price and profit are owner-level numbers: what the business pays for
 * stock, and what it makes per sale. A shopkeeper or cashier needs the selling
 * price to ring up a sale — they have no reason to see the margin on it.
 *
 * This is the single place that decides who may see those figures. Enforced
 * server-side (including in the offline sync feed, so the numbers never reach
 * a non-owner's device at all) rather than by hiding UI, which a client could
 * simply ignore.
 *
 * PHASE 24: delegates to permissions.server.ts's 'view_cost_price'
 * capability — admin/shop_owner still always pass (hardcoded there), but a
 * shop_manager/shopkeeper/cashier/assistant can now be individually granted
 * it from the Permissions screen instead of it being all-or-nothing by
 * position.
 */

/** Fields to strip, per synced entity, when the caller isn't privileged. */
export const COST_FIELDS: Record<string, string[]> = {
  Product: ['costPrice'],
  SalesEntry: ['costPrice'],
  ShopStockVariant: ['costPrice'],
};

/** True when this caller may see cost/profit figures (and set cost price). */
export async function canViewCostData(payload: VerifiedPayload): Promise<boolean> {
  return hasCapability(payload, 'view_cost_price');
}

/**
 * Null out the cost fields on a synced row. Null (rather than dropping the
 * key) keeps the payload shape stable for clients that expect the column, and
 * reads as "unknown" — which is exactly how the app already treats a missing
 * cost snapshot.
 */
export function redactCostFields(entity: string, row: Record<string, unknown>): Record<string, unknown> {
  const fields = COST_FIELDS[entity];
  if (!fields?.length) return row;
  const copy = { ...row };
  for (const f of fields) {
    if (f in copy) copy[f] = null;
  }
  return copy;
}
