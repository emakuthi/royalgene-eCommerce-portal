import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { resolveAdminPortalUserId } from './mobile-shop-auth';

type Payload = { userId: string; role?: string | null; organizationId?: string | null };

const isAdmin = (p: Payload) => p.role === 'admin' || p.role === 'super_admin';

/**
 * The caller's PortalUser.id, which StockTransfer requires (a foreign key)
 * for who sent or resolved a transfer. Admins may have none yet — one is
 * found or made for them the same way the mobile API does.
 */
export async function portalUserIdFor(p: Payload, shopId: string): Promise<string> {
  if (isAdmin(p)) return resolveAdminPortalUserId(p.userId, shopId, p.organizationId as string);
  const { data } = await supabaseAdmin.from('PortalUser').select('id').eq('userId', p.userId).limit(1).maybeSingle();
  return data?.id as string;
}

/** The shop a non-admin portal user is assigned to; null for admins (they act for every shop). */
export async function assignedShopId(p: Payload): Promise<string | null> {
  if (isAdmin(p)) return null;
  const { data } = await supabaseAdmin.from('PortalUser').select('shopId').eq('userId', p.userId).limit(1).maybeSingle();
  return (data?.shopId as string | undefined) ?? '';
}

/**
 * Whether the caller may act for `shopId` — send from it, or approve/reject
 * what's coming into it. Admins: any shop (the caller checks the business);
 * everyone else: only the shop they're assigned to.
 */
export async function canActForShop(p: Payload, shopId: string): Promise<boolean> {
  const assigned = await assignedShopId(p);
  return assigned === null || assigned === shopId;
}
