import { supabaseAdmin } from '@/lib/supabase-client';

/**
 * Resolve the shop ids an "All Shops" aggregate query should cover: every
 * active shop in the caller's org. A platform account (no organizationId)
 * gets nothing — platform support does not see tenant operational data.
 */
export async function getOrgShopIds(organizationId: string | null): Promise<string[]> {
  if (!organizationId) return [];
  const query = supabaseAdmin
    .from('Shop').select('id').eq('isActive', true).eq('organizationId', organizationId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map((s: { id: string }) => s.id);
}
