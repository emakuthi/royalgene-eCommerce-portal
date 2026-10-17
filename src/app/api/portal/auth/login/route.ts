import { NextRequest } from 'next/server';
import bcryptjs from 'bcryptjs';
import { supabaseAdmin } from '@/lib/supabase-client';
import { signAuthToken } from '@/lib/auth.server';
import logger from '@/lib/logger';
import type { User } from '@/lib/types';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { isRootDomainHost } from '@/lib/tenant';
import { getOrgUrlFor } from '@/lib/urls';

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const { email, password } = await request.json();
    logger.info('Portal login attempt', { email, endpoint: '/api/portal/auth/login', method: 'POST' });

    // User.email is unique per-organization (not globally), so login must be
    // scoped to the tenant resolved by middleware from the request subdomain
    // (x-org-id) — plus platform-level users (organizationId IS NULL), who
    // can log in from any subdomain.
    const hostOrgId = request.headers.get('x-org-id');
    let userQuery = supabaseAdmin.from('User').select('*').eq('email', email.toLowerCase());
    userQuery = hostOrgId
      ? userQuery.or(`organizationId.eq.${hostOrgId},organizationId.is.null`)
      : userQuery.is('organizationId', null);

    const { data: userData, error: userError } = await userQuery.maybeSingle();

    if (userError) {
      logger.warn('Portal login: user lookup failed', { error: userError.message, endpoint: '/api/portal/auth/login' });
    }

    let user = userData && (await bcryptjs.compare(password, userData.password)) ? userData : null;

    // The main address (apex/www) belongs to the default tenant, but it's also
    // where every other workspace's people naturally go to sign in. There,
    // look the email up across workspaces like the mobile login does; the
    // browser is then handed to that workspace's own address below.
    if (!user && isRootDomainHost(request.headers.get('host'))) {
      user = await findOtherWorkspaceUser(email.toLowerCase(), password, hostOrgId);
    }

    if (!user) {
      logger.warn('Portal login failed: no account / bad password', { email, endpoint: '/api/portal/auth/login' });
      return jsonResponse({ success: false, error: 'Invalid credentials' }, 401);
    }

    // Check if user is portal_user or admin
    if (user.role !== 'portal_user' && user.role !== 'admin' && user.role !== 'super_admin') {
      logger.warn('Portal login failed: invalid role', { email, role: user.role, endpoint: '/api/portal/auth/login' });
      return jsonResponse({ success: false, error: 'Invalid credentials' }, 401);
    }

    // Get portal user details if portal_user role
    let portalUser = null;
    let shop = null;

    if (user.role === 'portal_user') {
      const { data: portalUserData, error: portalError } = await supabaseAdmin
        .from('PortalUser')
        .select('id, userId, shopId, position, isActive, createdAt, updatedAt')
        .eq('userId', user.id)
        .single();

      if (portalError || !portalUserData) {
        logger.warn('Portal login failed: portal user not found', { userId: user.id, endpoint: '/api/portal/auth/login' });
        return jsonResponse({ success: false, error: 'Portal access denied' }, 403);
      }

      portalUser = portalUserData;

      if (!portalUser.isActive) {
        logger.warn('Portal login failed: portal user inactive', { userId: user.id, endpoint: '/api/portal/auth/login' });
        return jsonResponse({ success: false, error: 'Portal access denied' }, 403);
      }

      // Get shop details
      const { data: shopData } = await supabaseAdmin
        .from('Shop')
        .select('id, name, location')
        .eq('id', portalUser.shopId)
        .single();

      shop = shopData;

      // Update last login
      await supabaseAdmin
        .from('PortalUser')
        .update({ lastLogin: new Date().toISOString() })
        .eq('id', portalUser.id);
    }

    // Generate token with proper type conversion
    const typedUser: User = {
      ...user,
      role: user.role as 'customer' | 'admin' | 'portal_user' | 'super_admin',
      phone: user.phone ?? undefined,
      address: user.address ?? undefined,
    };
    const token = signAuthToken({
      userId: user.id,
      organizationId: user.organizationId ?? null,
      email: user.email,
      role: typedUser.role,
      shopId: portalUser?.shopId ?? null,
    });

    logger.info('Portal login successful', {
      userId: user.id,
      email,
      role: user.role,
      shopId: portalUser?.shopId,
      endpoint: '/api/portal/auth/login',
      duration: Date.now() - startTime
    });

    // Signed in from another workspace's address: send the browser to its own
    // address through /session-bridge (the same handoff signup and Google
    // sign-in use), since the session is stored per address.
    let redirectUrl: string | null = null;
    if (user.organizationId && user.organizationId !== hostOrgId) {
      const { data: org } = await supabaseAdmin
        .from('Organization')
        .select('slug, customDomain, customDomainStatus')
        .eq('id', user.organizationId)
        .maybeSingle();
      if (!org) {
        logger.warn('Portal login failed: workspace not found', { userId: user.id, endpoint: '/api/portal/auth/login' });
        return jsonResponse({ success: false, error: 'Invalid credentials' }, 401);
      }
      const params = new URLSearchParams({ token, name: user.name || '' });
      redirectUrl = getOrgUrlFor(org, `/session-bridge?${params.toString()}`);
    }

    return jsonResponse({ success: true, data: { user: { id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId ?? null }, portalUser, shop, token, redirectUrl } }, 200);
  } catch (error) {
    logger.error('Portal login error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/portal/auth/login',
      duration: Date.now() - startTime
    });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

/**
 * The one account in another workspace whose password matches, or null.
 * More than one match (legacy duplicate emails) stays ambiguous here; those
 * people sign in on their workspace's own address.
 */
async function findOtherWorkspaceUser(email: string, password: string, hostOrgId: string | null) {
  let query = supabaseAdmin.from('User').select('*').eq('email', email).not('organizationId', 'is', null);
  if (hostOrgId) query = query.neq('organizationId', hostOrgId);
  const { data: candidates, error } = await query;
  if (error) {
    logger.error('Portal login: workspace lookup failed', { error: error.message, endpoint: '/api/portal/auth/login' });
    return null;
  }
  const matched = [];
  for (const candidate of candidates ?? []) {
    if (candidate.password && (await bcryptjs.compare(password, candidate.password))) matched.push(candidate);
  }
  return matched.length === 1 ? matched[0] : null;
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
