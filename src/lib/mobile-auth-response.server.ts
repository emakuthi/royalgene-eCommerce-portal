import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { signAuthToken } from './auth.server';
import { registerDevice, type DeviceInfo } from './device-registry.server';

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
export async function buildMobileAuthResponse(
  userId: string,
  device?: DeviceInfo,
): Promise<{ ok: true; data: MobileAuthPayload } | { ok: false; error: string }> {
  const { data: user, error: userError } = await supabaseAdmin.from('User').select('*').eq('id', userId).maybeSingle();
  if (userError || !user) return { ok: false, error: 'User not found' };

  // A platform account (super_admin, no organizationId) now has its own
  // Platform Console in the app — this used to hard-block them entirely,
  // back when the only way to manage the platform was the web console.
  // Every OTHER role always has an organizationId (an "admin" is a
  // workspace owner, never platform-level) — no organizationId there is
  // corrupted data, not a legitimate platform account, so that case still
  // gets rejected outright.
  if (user.role !== 'super_admin' && !user.organizationId) {
    return { ok: false, error: 'This account has no workspace. Contact support.' };
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
    deviceId: device?.deviceId ?? null,
  });

  if (device && user.organizationId) {
    // Best-effort — registerDevice never throws, a registry hiccup must not fail login.
    await registerDevice(user.organizationId, user.id, device);
  }

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
  // A platform account has no organizationId to scope this by — without the
  // explicit exclusion here, an admin with no shopId (which a super_admin
  // always is) would fall through to an unfiltered Shop query and get back
  // every active shop across every tenant in the database.
  if (isAdmin && !shopId && user.organizationId) {
    const shopsQuery = supabaseAdmin.from('Shop').select('id, name, location, phone, address').eq('isActive', true).eq('organizationId', user.organizationId).order('name', { ascending: true });
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
