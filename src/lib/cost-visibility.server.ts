import 'server-only';
import { supabaseAdmin } from './supabase-client';
import type { VerifiedPayload } from './auth.server';

/**
 * Cost price and profit are owner-level numbers: what the business pays for
 * stock, and what it makes per sale. A shopkeeper or cashier needs the selling
 * price to ring up a sale — they have no reason to see the margin on it.
 *
 * This is the single place that decides who may see those figures. Enforced
 * server-side (including in the offline sync feed, so the numbers never reach
 * a non-owner's device at all) rather than by hiding UI, which a client could
 * simply ignore.
 */

/** Positions that own the business rather than staff it. Legacy spellings included — see types.ts. */
const OWNER_POSITIONS = new Set(['shop_owner', 'owner', 'admin']);

/** Fields to strip, per synced entity, when the caller isn't privileged. */
export const COST_FIELDS: Record<string, string[]> = {
  Product: ['costPrice'],
  SalesEntry: ['costPrice'],
};

/**
 * True when this caller may see cost/profit figures.
 *
 * `admin` is the workspace owner's own role (signup creates admin + a
 * shop_owner PortalUser). A `portal_user` is checked against their active
 * PortalUser positions, so an owner recorded only by position still counts.
 */
export async function canViewCostData(payload: VerifiedPayload): Promise<boolean> {
  if (payload.role === 'admin' || payload.role === 'super_admin') return true;
  if (!payload.userId) return false;

  const { data } = await supabaseAdmin
    .from('PortalUser')
    .select('position')
    .eq('userId', payload.userId)
    .eq('isActive', true);

  return (data ?? []).some((row) =>
    OWNER_POSITIONS.has(String((row as { position?: unknown }).position ?? '').toLowerCase()),
  );
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
