import 'server-only';
import { supabaseAdmin } from './supabase-client';
import type { VerifiedPayload } from './auth.server';

/**
 * Per-organization, per-role capability toggles — the "define permissions
 * for every role" screen (portal + Android) reads and writes through this
 * file. An org that never opens that screen runs entirely on
 * [DEFAULT_PERMISSIONS] — [RolePermission] only ever holds the rows an
 * admin has explicitly overridden away from the default.
 *
 * "admin" (the workspace-owner account, JWT role) and the "shop_owner"
 * PortalUser position are NOT part of the editable matrix — both always
 * have every capability, hardcoded in [resolveEffectiveRole]/[hasCapability],
 * so an admin can never lock themselves (or the person who owns the shop)
 * out by misconfiguring a row. This mirrors the existing owner-bypass rule
 * in cost-visibility.server.ts, generalised to more than just cost data.
 */

export type Capability =
  | 'view_cost_price'
  | 'add_inventory'
  | 'edit_inventory'
  | 'delete_inventory'
  | 'record_sales'
  | 'manage_staff';

/** The only positions a permission ROW can apply to — admin/shop_owner are always full, see class doc. */
export const EDITABLE_ROLES = ['shop_manager', 'shopkeeper', 'cashier', 'assistant'] as const;
export type EditableRole = (typeof EDITABLE_ROLES)[number];

export const PERMISSION_CATALOG: { key: Capability; label: string; description: string }[] = [
  { key: 'view_cost_price', label: 'View & edit cost price', description: 'See cost price and profit figures, and set cost price on a product.' },
  { key: 'add_inventory', label: 'Add inventory items', description: 'Create new products/stock in a shop.' },
  { key: 'edit_inventory', label: 'Edit inventory items', description: 'Change an existing product’s details, price, images, or stock breakdown.' },
  { key: 'delete_inventory', label: 'Delete inventory items', description: 'Remove a product from the catalog.' },
  { key: 'record_sales', label: 'Record sales', description: 'Ring up a sale against shop stock.' },
  { key: 'manage_staff', label: 'Manage staff', description: 'Change a teammate’s role, shop assignment, or active status.' },
];

const CAPABILITY_KEYS = new Set<string>(PERMISSION_CATALOG.map((p) => p.key));
export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && CAPABILITY_KEYS.has(value);
}

/**
 * Hardcoded fallback for a role with no override row — chosen to match what
 * the app already did in practice before this permission system existed
 * (shop_manager could freely add/edit inventory and record sales; nobody
 * but admin/shop_owner ever saw cost price or could manage staff), except
 * add/edit inventory for non-manager staff, which is now opt-in rather than
 * wide open — the admin can flip it back on per role from the new screen.
 */
export const DEFAULT_PERMISSIONS: Record<EditableRole, Record<Capability, boolean>> = {
  shop_manager: { view_cost_price: false, add_inventory: true, edit_inventory: true, delete_inventory: false, record_sales: true, manage_staff: false },
  shopkeeper: { view_cost_price: false, add_inventory: false, edit_inventory: false, delete_inventory: false, record_sales: true, manage_staff: false },
  cashier: { view_cost_price: false, add_inventory: false, edit_inventory: false, delete_inventory: false, record_sales: true, manage_staff: false },
  assistant: { view_cost_price: false, add_inventory: false, edit_inventory: false, delete_inventory: false, record_sales: true, manage_staff: false },
};

function normalizeRole(position: unknown): EditableRole | null {
  const p = String(position ?? '').toLowerCase();
  // Legacy spellings — see cost-visibility.server.ts / types.ts.
  if (p === 'manager') return 'shop_manager';
  if (p === 'staff') return 'shopkeeper';
  if ((EDITABLE_ROLES as readonly string[]).includes(p)) return p as EditableRole;
  return null;
}

/** True for the JWT role or PortalUser position that always has every capability — see class doc. */
function isOwnerLevel(role: string | null, position: unknown): boolean {
  if (role === 'admin' || role === 'super_admin') return true;
  const p = String(position ?? '').toLowerCase();
  return p === 'shop_owner' || p === 'owner';
}

/**
 * Resolves what this caller's PortalUser position is, for the org their
 * token belongs to. Returns null for a caller with no active PortalUser row
 * (shouldn't normally reach a permission check, but callers must treat it
 * as "no capabilities" rather than throw).
 */
async function loadCallerPosition(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('PortalUser')
    .select('position')
    .eq('userId', userId)
    .eq('isActive', true)
    .limit(1);
  return (data && data[0] && (data[0] as { position?: string }).position) || null;
}

/**
 * True when this caller may exercise [capability]. Owner-level callers
 * (admin/super_admin JWT role, or shop_owner position) always pass. Anyone
 * else resolves to one of [EDITABLE_ROLES] and is checked against a stored
 * override, falling back to [DEFAULT_PERMISSIONS].
 */
export async function hasCapability(payload: VerifiedPayload, capability: Capability): Promise<boolean> {
  if (isOwnerLevel(payload.role ?? null, null)) return true;
  if (!payload.userId) return false;

  const position = await loadCallerPosition(payload.userId);
  if (isOwnerLevel(payload.role ?? null, position)) return true;

  const role = normalizeRole(position);
  if (!role || !payload.organizationId) return false;

  const { data } = await supabaseAdmin
    .from('RolePermission')
    .select('enabled')
    .eq('organizationId', payload.organizationId)
    .eq('role', role)
    .eq('permission', capability)
    .maybeSingle();

  if (data && typeof (data as { enabled?: unknown }).enabled === 'boolean') {
    return (data as { enabled: boolean }).enabled;
  }
  return DEFAULT_PERMISSIONS[role][capability];
}

/**
 * The full editable matrix for an organization — [DEFAULT_PERMISSIONS] with
 * any stored overrides applied on top. Used by the Permissions screen (both
 * portal and Android) to render the current state of every toggle.
 */
export async function getEffectivePermissions(
  organizationId: string,
): Promise<Record<EditableRole, Record<Capability, boolean>>> {
  const matrix: Record<EditableRole, Record<Capability, boolean>> = {
    shop_manager: { ...DEFAULT_PERMISSIONS.shop_manager },
    shopkeeper: { ...DEFAULT_PERMISSIONS.shopkeeper },
    cashier: { ...DEFAULT_PERMISSIONS.cashier },
    assistant: { ...DEFAULT_PERMISSIONS.assistant },
  };

  const { data } = await supabaseAdmin
    .from('RolePermission')
    .select('role, permission, enabled')
    .eq('organizationId', organizationId);

  for (const row of (data ?? []) as { role: string; permission: string; enabled: boolean }[]) {
    const role = normalizeRole(row.role);
    if (role && isCapability(row.permission)) {
      matrix[role][row.permission] = row.enabled;
    }
  }
  return matrix;
}

/** Upserts one override. `enabled === DEFAULT_PERMISSIONS[role][permission]` still stores a row — harmless, just not minimal; keeps the write path simple. */
export async function setPermissionOverride(
  organizationId: string,
  role: EditableRole,
  permission: Capability,
  enabled: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseAdmin
    .from('RolePermission')
    .upsert(
      [{ organizationId, role, permission, enabled, updatedAt: new Date().toISOString() }],
      { onConflict: 'organizationId,role,permission' },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
