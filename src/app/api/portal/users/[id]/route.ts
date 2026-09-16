import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken, hashPassword, type VerifiedPayload } from '@/lib/auth.server';
import { assertTenantMatch } from '@/lib/tenant-guard';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { v4 as uuidv4 } from 'uuid';
import { isValidEmail, normalizeEmail } from '@/lib/email-validation';

// Every column across the schema that points at PortalUser.id — a purge has
// to reassign all of them to the placeholder before the row can be removed,
// not just the one FK that happened to block a plain DELETE.
const PORTAL_USER_REFERENCES: Array<{ table: string; column: string }> = [
  { table: 'SalesEntry', column: 'portalUserId' },
  { table: 'StockTransaction', column: 'portalUserId' },
  { table: 'StockTransfer', column: 'initiatedByPortalUserId' },
  { table: 'StockTransfer', column: 'resolvedByPortalUserId' },
  { table: 'Alert', column: 'portaluserid' },
];

const DELETED_USER_EMAIL_PREFIX = 'deleted-user+';

function isDeletedUserPlaceholder(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase().startsWith(DELETED_USER_EMAIL_PREFIX);
}

/**
 * Finds (or lazily creates) this organization's permanent "Deleted User"
 * placeholder — one per org, disabled so it can never log in — that a purge
 * reassigns history to instead of leaving it orphaned or blocking on the
 * NOT NULL portalUserId columns above.
 */
async function resolveDeletedUserPlaceholder(organizationId: string): Promise<{ portalUserId: string } | null> {
  const placeholderEmail = `${DELETED_USER_EMAIL_PREFIX}${organizationId}@internal.royalgene`;
  const now = new Date().toISOString();

  const { data: existingUser } = await supabaseAdmin
    .from('User').select('id').eq('email', placeholderEmail).maybeSingle();

  let userId = existingUser?.id as string | undefined;

  if (!userId) {
    userId = uuidv4();
    const unusablePassword = await hashPassword(uuidv4() + uuidv4());
    const { error: userError } = await supabaseAdmin.from('User').insert([{
      id: userId, email: placeholderEmail, password: unusablePassword, name: 'Deleted User',
      role: 'portal_user', twoFactorEnabled: false, organizationId, createdAt: now, updatedAt: now,
    }]);
    if (userError) return null;
  }

  const { data: existingPu } = await supabaseAdmin
    .from('PortalUser').select('id').eq('userId', userId).eq('organizationId', organizationId).maybeSingle();
  if (existingPu?.id) return { portalUserId: existingPu.id as string };

  // PortalUser.shopId is NOT NULL — anchor the placeholder to any shop in
  // this org (its own isActive:false already keeps it out of real use).
  const { data: anyShop } = await supabaseAdmin
    .from('Shop').select('id').eq('organizationId', organizationId).limit(1).maybeSingle();
  if (!anyShop?.id) return null;

  const portalUserId = uuidv4();
  const { error: puError } = await supabaseAdmin.from('PortalUser').insert([{
    id: portalUserId, userId, shopId: anyShop.id, position: 'archived',
    isActive: false, mobileAccess: false, organizationId, createdAt: now, updatedAt: now,
  }]);
  if (puError) return null;

  return { portalUserId };
}

function requireAdmin(request: NextRequest): NextResponse | VerifiedPayload {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
  const payload = verifyToken(token);
  if (!payload) return jsonResponse({ success: false, error: 'Invalid token' }, 401);
  if (payload.role !== 'admin' && payload.role !== 'super_admin')
    return jsonResponse({ success: false, error: 'Admin access required' }, 403);
  const tenantMismatch = assertTenantMatch(request, payload);
  if (tenantMismatch) return tenantMismatch;
  return payload;
}

// PATCH /api/portal/users/[id] — update position, shopId, isActive, name, email
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const { name, email, position, shopId, isActive, mobileAccess } = await request.json();

  // Fetch existing portal user to get userId — an org "admin" (not platform
  // super_admin) may only ever touch a PortalUser belonging to their own org.
  const { data: pu, error: fetchError } = await supabaseAdmin
    .from('PortalUser').select('id, userId, organizationId').eq('id', id).single();
  if (fetchError || !pu) return jsonResponse({ success: false, error: 'Portal user not found' }, 404);

  if (auth.organizationId && pu.organizationId !== auth.organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  // If reassigning to a different shop, that shop must be in the same organization.
  if (shopId !== undefined) {
    const { data: shopCheck } = await supabaseAdmin
      .from('Shop')
      .select('id, organizationId')
      .eq('id', shopId)
      .maybeSingle();
    if (!shopCheck || shopCheck.organizationId !== pu.organizationId) {
      return jsonResponse({ success: false, error: 'Forbidden: shop does not belong to this organization' }, 403);
    }
  }

  // Update PortalUser fields
  const puUpdate: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (position !== undefined) puUpdate.position = position;
  if (shopId !== undefined) puUpdate.shopId = shopId;
  if (isActive !== undefined) puUpdate.isActive = isActive;
  if (mobileAccess !== undefined) puUpdate.mobileAccess = mobileAccess;

  const { error: puError } = await supabaseAdmin.from('PortalUser').update(puUpdate).eq('id', id);
  if (puError) return jsonResponse({ success: false, error: puError.message }, 500);

  // Update User fields if provided
  if (name !== undefined || email !== undefined) {
    if (email !== undefined && !isValidEmail(String(email))) {
      return jsonResponse({ success: false, error: 'Enter a valid email address' }, 400);
    }
    const userUpdate: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (name !== undefined) userUpdate.name = name;
    if (email !== undefined) userUpdate.email = normalizeEmail(String(email));
    const { error: uError } = await supabaseAdmin.from('User').update(userUpdate).eq('id', pu.userId);
    if (uError) return jsonResponse({ success: false, error: uError.message }, 500);
  }

  // Return updated record
  const { data: updated } = await supabaseAdmin
    .from('PortalUser')
    .select('id, userId, shopId, position, isActive, mobileAccess, createdAt, user:User(id,name,email,phone), shop:Shop(id,name,location)')
    .eq('id', id)
    .single();

  return jsonResponse({ success: true, data: updated });
}

// DELETE /api/portal/users/[id] — remove a PortalUser (and its User row when
// it isn't shared). If the person has sales / stock history their row can't be
// deleted, so we deactivate the login instead and say so.
// ?purge=true + body { confirm: "<exact email>" } permanently removes the
// person by reassigning every history row that points at them to this org's
// "Deleted User" placeholder first. Irreversible — the name is gone, only
// history stays.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const purge = request.nextUrl.searchParams.get('purge') === 'true';

  const { data: pu } = await supabaseAdmin
    .from('PortalUser').select('userId, organizationId').eq('id', id).maybeSingle();
  if (!pu) return jsonResponse({ success: false, error: 'Portal user not found' }, 404);
  if (auth.organizationId && pu.organizationId !== auth.organizationId) {
    return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  if (purge) {
    const orgId = pu.organizationId as string;

    const { data: userRow } = await supabaseAdmin.from('User').select('email').eq('id', pu.userId).maybeSingle();
    if (isDeletedUserPlaceholder(userRow?.email)) {
      return jsonResponse({ success: false, error: 'This account cannot be deleted' }, 400);
    }

    const body = await request.json().catch(() => ({}));
    const confirm = typeof body?.confirm === 'string' ? body.confirm.trim().toLowerCase() : '';
    if (!userRow?.email || confirm !== userRow.email.toLowerCase()) {
      return jsonResponse({ success: false, error: 'Type the exact email to confirm the purge' }, 400);
    }

    const placeholder = await resolveDeletedUserPlaceholder(orgId);
    if (!placeholder) {
      return jsonResponse({ success: false, error: 'Failed to prepare the placeholder account for this purge' }, 500);
    }

    const now = new Date().toISOString();
    const reassignments = await Promise.all(
      PORTAL_USER_REFERENCES.map(({ table, column }) =>
        supabaseAdmin.from(table).update({ [column]: placeholder.portalUserId, updatedAt: now }).eq(column, id)
      )
    );
    const reassignError = reassignments.find((r) => r.error)?.error;
    if (reassignError) {
      return jsonResponse({ success: false, error: `Failed to reassign history: ${reassignError.message}` }, 500);
    }

    const { error: puDeleteError } = await supabaseAdmin.from('PortalUser').delete().eq('id', id);
    if (puDeleteError) {
      return jsonResponse({ success: false, error: puDeleteError.message }, 500);
    }

    const [{ data: userCheck }, { data: otherMemberships }] = await Promise.all([
      supabaseAdmin.from('User').select('role').eq('id', pu.userId).maybeSingle(),
      supabaseAdmin.from('PortalUser').select('id').eq('userId', pu.userId).limit(1),
    ]);
    if (userCheck?.role === 'portal_user' && (!otherMemberships || otherMemberships.length === 0)) {
      await supabaseAdmin.from('User').delete().eq('id', pu.userId);
    }

    return jsonResponse({ success: true, data: { purged: true } });
  }

  const { error } = await supabaseAdmin.from('PortalUser').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') {
      await supabaseAdmin
        .from('PortalUser')
        .update({ isActive: false, mobileAccess: false, updatedAt: new Date().toISOString() })
        .eq('id', id);
      return jsonResponse({
        success: true,
        data: { deactivated: true },
        message: 'This person has sales or stock history, so their access was disabled instead of deleted.',
      });
    }
    return jsonResponse({ success: false, error: error.message }, 500);
  }

  // Remove the underlying User row only when it's a plain portal_user with no
  // other shop membership left; ignore an FK error (leaves a harmless orphan).
  if (pu.userId) {
    const [{ data: userRow }, { data: otherMemberships }] = await Promise.all([
      supabaseAdmin.from('User').select('role').eq('id', pu.userId).maybeSingle(),
      supabaseAdmin.from('PortalUser').select('id').eq('userId', pu.userId).limit(1),
    ]);
    if (userRow?.role === 'portal_user' && (!otherMemberships || otherMemberships.length === 0)) {
      await supabaseAdmin.from('User').delete().eq('id', pu.userId);
    }
  }

  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('PATCH,DELETE,OPTIONS');
}
