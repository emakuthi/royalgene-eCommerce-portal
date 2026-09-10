import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { signAuthToken } from './auth.server';

function formatShop(s: Record<string, unknown>) {
  const phoneVal = s['phone'];
  const fallbackPhoneVal = s['phoneNumber'];
  const phoneNumber = typeof phoneVal === 'string' ? phoneVal : (typeof fallbackPhoneVal === 'string' ? fallbackPhoneVal : null);
  return {
    id: typeof s['id'] === 'string' ? s['id'] : (typeof s['id'] === 'number' ? String(s['id']) : undefined),
    name: typeof s['name'] === 'string' ? s['name'] : undefined,
    location: typeof s['location'] === 'string' ? s['location'] : undefined,
    phoneNumber,
    address: typeof s['address'] === 'string' ? s['address'] : undefined,
  };
}

export interface MobileAuthPayload {
  token: string;
  user: { id: string; email: string; name: string; phone: string | null; role: string; organizationId: string | null };
  organization: {
    id: string;
    name: string;
    slug: string;
    /** The tenant's own domain, when verified — the app prefers it as its API host. */
    customDomain: string | null;
    customDomainStatus: string | null;
  } | null;
  shop: ReturnType<typeof formatShop> | null;
  shops?: ReturnType<typeof formatShop>[];
}

/**
 * Builds the exact same response shape as POST /api/mobile/auth/login's
 * success path, from a userId that's already been authenticated by
 * whatever means (password there, a verified Google/Facebook identity
 * here) — so every mobile auth entry point behaves identically once a
 * userId is established: same admin/PortalUser/allShops resolution, same
 * session data the client expects and already knows how to parse.
 */
export async function buildMobileAuthResponse(userId: string): Promise<{ ok: true; data: MobileAuthPayload } | { ok: false; error: string }> {
  const { data: user, error: userError } = await supabaseAdmin.from('User').select('*').eq('id', userId).maybeSingle();
  if (userError || !user) return { ok: false, error: 'User not found' };

  // The app is a tenant operations tool. A platform account (super_admin,
  // no organizationId) has no shop, no inventory and no tenant to act on —
  // platform staff work from the web console.
  if (user.role === 'super_admin' || !user.organizationId) {
    return { ok: false, error: 'Platform accounts sign in on the web console, not the app.' };
  }

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  const { data: portalUsers } = await supabaseAdmin.from('PortalUser').select('*, Shop(*)').eq('userId', user.id);
  const portalUser = portalUsers && portalUsers.length > 0 ? portalUsers[0] : null;

  if (!isAdmin && !portalUser) {
    return { ok: false, error: 'This account is not authorized for mobile app access' };
  }
  if (!isAdmin && portalUser && (portalUser as Record<string, unknown>).mobileAccess === false) {
    return { ok: false, error: 'Mobile access has been disabled for this account. Contact your administrator.' };
  }

  // A suspended / closed workspace must not hand out a usable session — every
  // request would 403 at the edge, and the app would loop back to login.
  // Platform super_admins (no organizationId) are exempt.
  if (user.organizationId) {
    const { data: orgStatus } = await supabaseAdmin
      .from('Organization')
      .select('status, deletedAt')
      .eq('id', user.organizationId)
      .maybeSingle();
    const status = orgStatus?.status as string | undefined;
    if (status === 'cancelled' || orgStatus?.deletedAt) {
      return { ok: false, error: 'This workspace has been closed. Contact support if this is a mistake.' };
    }
    if (status === 'suspended') {
      return { ok: false, error: 'This workspace is suspended. Contact support to reactivate it.' };
    }
  }

  const shopId = portalUser?.shopId ?? null;

  const token = signAuthToken({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    email: user.email,
    role: user.role,
    shopId,
  });

  let organization: MobileAuthPayload['organization'] = null;
  if (user.organizationId) {
    const { data: orgRow } = await supabaseAdmin
      .from('Organization')
      .select('id, name, slug, customDomain, customDomainStatus')
      .eq('id', user.organizationId)
      .maybeSingle();
    if (orgRow) {
      organization = {
        id: orgRow.id,
        name: orgRow.name,
        slug: orgRow.slug,
        customDomain: (orgRow.customDomain as string | null) ?? null,
        customDomainStatus: (orgRow.customDomainStatus as string | null) ?? null,
      };
    }
  }

  let shop: Record<string, unknown> | null = null;
  if (shopId) {
    const { data: shopRow } = await supabaseAdmin.from('Shop').select('id, name, location, phone, address').eq('id', shopId).maybeSingle();
    shop = shopRow as Record<string, unknown> | null;
  }

  let allShops: Array<Record<string, unknown>> | null = null;
  if (isAdmin && !shopId) {
    let shopsQuery = supabaseAdmin.from('Shop').select('id, name, location, phone, address').eq('isActive', true).order('name', { ascending: true });
    if (user.organizationId) shopsQuery = shopsQuery.eq('organizationId', user.organizationId);
    const { data: shops } = await shopsQuery;
    allShops = (shops as Array<Record<string, unknown>>) ?? [];
  }

  return {
    ok: true,
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone ?? null,
        role: user.role,
        organizationId: user.organizationId ?? null,
      },
      organization,
      shop: shop ? formatShop(shop) : null,
      shops: allShops ? allShops.map(formatShop) : undefined,
    },
  };
}
