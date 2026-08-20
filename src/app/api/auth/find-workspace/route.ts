import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

/**
 * POST /api/auth/find-workspace — { email } -> which workspace(s) this email
 * has portal access to. Tenant-optional (see middleware.ts TENANT_OPTIONAL_PATHS)
 * — by definition the caller doesn't know their tenant's subdomain yet (this
 * is what the mobile app's "find my workspace" flow calls). User.email is
 * unique per-organization, not globally, so one email can legitimately match
 * more than one workspace.
 *
 * Deliberately always returns 200 with a (possibly empty) list rather than a
 * 404/error when nothing matches — this can't be used to tell "no account
 * anywhere" apart from "account exists but isn't tied to an organization"
 * (e.g. a platform super_admin). It still reveals which named workspace(s)
 * an email belongs to, which is the normal tradeoff for a "find my
 * workspace" flow in a B2B product — reconsider if this app ever becomes
 * consumer-facing and needs stricter enumeration protection.
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return jsonResponse({ success: false, error: 'Email is required' }, 400);
    }

    const { data: users, error } = await supabaseAdmin
      .from('User')
      .select('organizationId')
      .eq('email', email.trim().toLowerCase())
      .not('organizationId', 'is', null);

    if (error) {
      logger.error('[find-workspace] user lookup failed', { error: error.message });
      return jsonResponse({ success: false, error: 'Lookup failed' }, 500);
    }

    const orgIds = Array.from(new Set((users ?? []).map((u) => u.organizationId as string).filter(Boolean)));
    if (orgIds.length === 0) {
      return jsonResponse({ success: true, data: { organizations: [] } });
    }

    const { data: orgs } = await supabaseAdmin
      .from('Organization')
      .select('name, slug')
      .in('id', orgIds)
      .eq('status', 'active');

    return jsonResponse({ success: true, data: { organizations: orgs ?? [] } });
  } catch (err) {
    logger.error('[find-workspace] error', { error: err instanceof Error ? err.message : String(err) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
