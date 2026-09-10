import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { hashPassword } from './auth.server';
import logger from './logger';

/**
 * Super-admin view of the people (User + PortalUser rows) inside one tenant,
 * plus the support actions a platform operator needs when a customer emails
 * in: fix a mistyped login email, confirm an address, hand out a temporary
 * password, toggle mobile access, or remove an account.
 */

export interface PlatformOrgMembership {
  portalUserId: string;
  shopId: string | null;
  shopName: string | null;
  position: string | null;
  isActive: boolean;
  mobileAccess: boolean;
  lastLogin: string | null;
}

export interface PlatformOrgUser {
  id: string;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  createdAt: string;
  emailVerified: boolean;
  memberships: PlatformOrgMembership[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function listOrganizationUsers(orgId: string): Promise<PlatformOrgUser[]> {
  const { data: users, error } = await supabaseAdmin
    .from('User')
    .select('id, name, email, role, phone, createdAt, emailVerifiedAt')
    .eq('organizationId', orgId)
    .order('createdAt', { ascending: true });
  if (error) throw new Error(error.message);

  const list = (users ?? []) as Array<Record<string, unknown>>;
  if (list.length === 0) return [];

  const { data: pus } = await supabaseAdmin
    .from('PortalUser')
    .select('id, userId, shopId, position, isActive, mobileAccess, lastLogin, Shop(name)')
    .in('userId', list.map((u) => u.id as string));

  const byUser = new Map<string, PlatformOrgMembership[]>();
  for (const raw of (pus ?? []) as Array<Record<string, unknown>>) {
    const uid = raw.userId as string;
    const arr = byUser.get(uid) ?? [];
    arr.push({
      portalUserId: raw.id as string,
      shopId: (raw.shopId as string | null) ?? null,
      shopName: ((raw.Shop as { name?: string } | null)?.name) ?? null,
      position: (raw.position as string | null) ?? null,
      isActive: raw.isActive !== false,
      mobileAccess: raw.mobileAccess !== false,
      lastLogin: (raw.lastLogin as string | null) ?? null,
    });
    byUser.set(uid, arr);
  }

  return list.map((u) => ({
    id: u.id as string,
    name: (u.name as string) ?? '',
    email: (u.email as string) ?? '',
    role: (u.role as string) ?? 'portal_user',
    phone: (u.phone as string | null) ?? null,
    createdAt: u.createdAt as string,
    emailVerified: Boolean(u.emailVerifiedAt),
    memberships: byUser.get(u.id as string) ?? [],
  }));
}

async function loadUserInOrg(orgId: string, userId: string) {
  const { data } = await supabaseAdmin
    .from('User')
    .select('id, role, organizationId')
    .eq('id', userId)
    .maybeSingle();
  if (!data || data.organizationId !== orgId) return null;
  return data as { id: string; role: string; organizationId: string };
}

export interface UpdateOrgUserPatch {
  email?: string;
  name?: string;
  phone?: string | null;
  /** Mark the address confirmed (or un-confirm it). */
  emailVerified?: boolean;
  /** Set a new password for the account (support-issued temporary password). */
  password?: string;
  /** Applies to every PortalUser membership this user has in the org. */
  mobileAccess?: boolean;
  isActive?: boolean;
}

export async function updateOrganizationUser(
  orgId: string,
  userId: string,
  patch: UpdateOrgUserPatch,
): Promise<{ ok: true; user: PlatformOrgUser } | { ok: false; status: number; error: string }> {
  const target = await loadUserInOrg(orgId, userId);
  if (!target) return { ok: false, status: 404, error: 'User not found in this tenant' };

  const userUpdate: Record<string, unknown> = {};

  if (patch.email !== undefined) {
    const email = patch.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, status: 400, error: 'Enter a valid email address' };
    const { data: clash } = await supabaseAdmin
      .from('User').select('id').eq('email', email).neq('id', userId).limit(1);
    if (clash && clash.length > 0) return { ok: false, status: 409, error: 'That email already belongs to another account' };
    userUpdate.email = email;
  }
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return { ok: false, status: 400, error: 'Name cannot be empty' };
    userUpdate.name = patch.name.trim();
  }
  if (patch.phone !== undefined) userUpdate.phone = patch.phone?.trim() || null;
  if (patch.emailVerified !== undefined) {
    userUpdate.emailVerifiedAt = patch.emailVerified ? new Date().toISOString() : null;
  }
  if (patch.password !== undefined) {
    if (patch.password.length < 8) return { ok: false, status: 400, error: 'Password must be at least 8 characters' };
    userUpdate.password = await hashPassword(patch.password);
  }

  if (Object.keys(userUpdate).length > 0) {
    userUpdate.updatedAt = new Date().toISOString();
    const { error } = await supabaseAdmin.from('User').update(userUpdate).eq('id', userId);
    if (error) {
      if (error.code === '23505') return { ok: false, status: 409, error: 'That email already belongs to another account' };
      return { ok: false, status: 500, error: error.message };
    }
  }

  const puUpdate: Record<string, unknown> = {};
  if (patch.mobileAccess !== undefined) puUpdate.mobileAccess = patch.mobileAccess;
  if (patch.isActive !== undefined) puUpdate.isActive = patch.isActive;
  if (Object.keys(puUpdate).length > 0) {
    puUpdate.updatedAt = new Date().toISOString();
    await supabaseAdmin.from('PortalUser').update(puUpdate).eq('userId', userId);
  }

  logger.info('[platform] tenant user updated', { orgId, userId, fields: Object.keys({ ...userUpdate, ...puUpdate }) });
  const users = await listOrganizationUsers(orgId);
  const user = users.find((u) => u.id === userId);
  return user ? { ok: true, user } : { ok: false, status: 500, error: 'Reload failed' };
}

export async function removeOrganizationUser(
  orgId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const target = await loadUserInOrg(orgId, userId);
  if (!target) return { ok: false, status: 404, error: 'User not found in this tenant' };
  if (target.role === 'super_admin') return { ok: false, status: 400, error: 'Platform accounts cannot be removed from here' };

  if (target.role === 'admin') {
    const { data: admins } = await supabaseAdmin
      .from('User').select('id').eq('organizationId', orgId).eq('role', 'admin');
    if ((admins ?? []).length <= 1) {
      return { ok: false, status: 400, error: 'This is the tenant’s only admin — reassign admin first' };
    }
  }

  await supabaseAdmin.from('PortalUser').delete().eq('userId', userId);
  const { error } = await supabaseAdmin.from('User').delete().eq('id', userId);
  if (error) return { ok: false, status: 500, error: error.message };

  logger.info('[platform] tenant user removed', { orgId, userId });
  return { ok: true };
}
