import { supabaseAdmin } from '@/lib/supabase-client';

/**
 * Resolve the shop ids an "All Shops" aggregate query should cover. Mirrors
 * the scoping already used for admin shop-visibility in
 * GET /api/mobile/shops and mobile login: an org-scoped admin sees every
 * active shop in their own org; a true super_admin (organizationId === null)
 * sees every active shop platform-wide.
 */
export async function getOrgShopIds(organizationId: string | null): Promise<string[]> {
  let query = supabaseAdmin.from('Shop').select('id').eq('isActive', true);
  if (organizationId) {
    query = query.eq('organizationId', organizationId);
  }
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((s: { id: string }) => s.id);
}
