import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { jsonResponse } from './apiResponse';

/**
 * Which shops' sales a signed-in user may see. Admins, and staff whose
 * position is manager or owner, see every shop in their business; everyone
 * else (shopkeeper, cashier, assistant…) only the shops they're assigned to
 * (a PortalUser row per shop). Shared by the portal and mobile routes and the
 * sync feed, so a shopkeeper can't read another shop's sales by picking it.
 */

type Payload = { userId: string; role?: string | null; organizationId?: string | null };

export type ShopRef = { id: string; name: string };

export const isBusinessAdmin = (p: Payload) => p.role === 'admin' || p.role === 'super_admin';

/** Staff positions that see every shop's sales, like an admin. */
const SEE_ALL_POSITIONS = new Set(['manager', 'shop_manager', 'owner', 'shop_owner']);

/** The caller's assigned shops; null when they see every shop (admin, manager, owner). */
export async function assignedShops(p: Payload): Promise<ShopRef[] | null> {
  if (isBusinessAdmin(p)) return null;
  const { data } = await supabaseAdmin
    .from('PortalUser')
    .select('shopId, position, shop:Shop(id, name)')
    .eq('userId', p.userId);
  const rows = (data ?? []) as unknown as Array<{ shopId: string | null; position: string | null; shop: { id: string; name: string | null } | null }>;
  if (rows.some((r) => SEE_ALL_POSITIONS.has((r.position ?? '').toLowerCase()))) return null;
  const seen = new Map<string, ShopRef>();
  for (const row of rows) {
    if (row.shopId && !seen.has(row.shopId)) seen.set(row.shopId, { id: row.shopId, name: row.shop?.name ?? 'Unnamed shop' });
  }
  return [...seen.values()];
}

/** The 403 for a shop the caller isn't assigned to — says which shop, and which ones they do have. */
export async function shopAccessDeniedResponse(shopId: string, allowed: ShopRef[]): Promise<Response> {
  const { data: shop } = await supabaseAdmin.from('Shop').select('name').eq('id', shopId).maybeSingle();
  const shopName = (shop?.name as string | undefined) ?? 'this shop';
  const names = allowed.map((s) => s.name);
  const yours = names.length === 0
    ? "You aren't assigned to any shop yet."
    : `You can only access ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`}.`;
  return jsonResponse({
    success: false,
    error: `You don't have access to ${shopName}. ${yours} Ask the business owner to add you to ${shopName} if you need it.`,
    code: 'SHOP_ACCESS_DENIED',
    allowedShops: allowed,
  }, 403);
}

/** Null when the caller may see `shopId`'s sales; otherwise the 403 to return. */
export async function denyUnlessShopAllowed(p: Payload, shopId: string): Promise<Response | null> {
  const allowed = await assignedShops(p);
  if (allowed === null || allowed.some((s) => s.id === shopId)) return null;
  return shopAccessDeniedResponse(shopId, allowed);
}
