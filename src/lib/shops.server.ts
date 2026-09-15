import 'server-only';
import { supabaseAdmin } from './supabase-client';

/**
 * Case-insensitive shop-name availability check within one organization —
 * shop names only need to be unique per tenant, not across unrelated ones.
 * Only active shops count, so a deactivated/renamed-away shop doesn't
 * permanently block reuse of its old name. Backed by the
 * `shop_name_lower_active_unique_per_org` index.
 */
export async function isShopNameAvailable(name: string, organizationId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('Shop')
    .select('id')
    .ilike('name', name)
    .eq('organizationId', organizationId)
    .eq('isActive', true)
    .maybeSingle();
  return !data;
}

/**
 * Auto-generated shop names (e.g. a social-login default) collide far more
 * often than user-chosen ones, so this retries with a numeric suffix rather
 * than failing outright — mirrors uniqueSlugFor in organizations.server.ts.
 */
export async function uniqueShopNameFor(baseName: string, organizationId: string): Promise<string> {
  let candidate = baseName;
  let suffix = 1;
  while (!(await isShopNameAvailable(candidate, organizationId))) {
    suffix += 1;
    candidate = `${baseName} (${suffix})`;
    if (suffix > 50) throw new Error('Could not generate a unique shop name');
  }
  return candidate;
}
