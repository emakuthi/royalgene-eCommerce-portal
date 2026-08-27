import 'server-only';
import { supabaseAdmin } from './supabase-client';

/**
 * Case-insensitive shop-name availability check across ALL tenants, not just
 * one organization — shop names must be globally unique. Only active shops
 * count, so a deactivated/renamed-away shop doesn't permanently block reuse
 * of its old name. Backed by the `shop_name_lower_active_unique` index.
 */
export async function isShopNameAvailable(name: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('Shop')
    .select('id')
    .ilike('name', name)
    .eq('isActive', true)
    .maybeSingle();
  return !data;
}

/**
 * Auto-generated shop names (e.g. a social-login default) collide far more
 * often than user-chosen ones, so this retries with a numeric suffix rather
 * than failing outright — mirrors uniqueSlugFor in organizations.server.ts.
 */
export async function uniqueShopNameFor(baseName: string): Promise<string> {
  let candidate = baseName;
  let suffix = 1;
  while (!(await isShopNameAvailable(candidate))) {
    suffix += 1;
    candidate = `${baseName} (${suffix})`;
    if (suffix > 50) throw new Error('Could not generate a unique shop name');
  }
  return candidate;
}
