import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { signAuthToken } from './auth.server';

export interface PortalAuthPayload {
  token: string;
  user: { id: string; email: string; name: string; role: string };
  portalUser: Record<string, unknown> | null;
  shop: Record<string, unknown> | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    customDomain?: string | null;
    customDomainStatus?: 'pending' | 'verified' | 'misconfigured' | null;
  } | null;
}

/**
 * Builds the same response shape POST /api/portal/auth/login returns, plus
 * `organization` (which that route never needed — password login always
 * already sits on the right subdomain). Social sign-in can auto-provision a
 * brand-new tenant unrelated to whatever host the request hit, so the
 * caller needs the resolved org's slug to redirect the browser to it via
 * /session-bridge, exactly like signup already does.
 */
export async function buildPortalAuthResponse(userId: string): Promise<{ ok: true; data: PortalAuthPayload } | { ok: false; error: string; status: number }> {
  const { data: user, error: userError } = await supabaseAdmin.from('User').select('*').eq('id', userId).maybeSingle();
  if (userError || !user) return { ok: false, error: 'User not found', status: 401 };

  if (user.role !== 'portal_user' && user.role !== 'admin' && user.role !== 'super_admin') {
    return { ok: false, error: 'Invalid credentials', status: 401 };
  }

  let portalUser: Record<string, unknown> | null = null;
  let shop: Record<string, unknown> | null = null;

  if (user.role === 'portal_user') {
    const { data: portalUserData } = await supabaseAdmin
      .from('PortalUser')
      .select('id, userId, shopId, position, isActive, createdAt, updatedAt')
      .eq('userId', user.id)
      .single();

    if (!portalUserData) return { ok: false, error: 'Portal access denied', status: 403 };
    if (!portalUserData.isActive) return { ok: false, error: 'Portal access denied', status: 403 };
    portalUser = portalUserData;

    const { data: shopData } = await supabaseAdmin.from('Shop').select('id, name, location').eq('id', portalUser.shopId as string).single();
    shop = shopData ?? null;

    await supabaseAdmin.from('PortalUser').update({ lastLogin: new Date().toISOString() }).eq('id', portalUser.id as string);
  }

  const token = signAuthToken({
    userId: user.id,
    organizationId: user.organizationId ?? null,
    email: user.email,
    role: user.role,
    shopId: (portalUser?.shopId as string | undefined) ?? null,
  });

  let organization: PortalAuthPayload['organization'] = null;
  if (user.organizationId) {
    const { data: orgRow } = await supabaseAdmin.from('Organization').select('id, name, slug, customDomain, customDomainStatus').eq('id', user.organizationId).maybeSingle();
    organization = (orgRow as typeof organization) ?? null;
  }

  return {
    ok: true,
    data: {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      portalUser,
      shop,
      organization,
    },
  };
}
