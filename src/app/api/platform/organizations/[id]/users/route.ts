import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import {
  listOrganizationUsers,
  removeOrganizationUser,
  updateOrganizationUser,
  type UpdateOrgUserPatch,
} from '@/lib/platform-users.server';

// People (logins) inside one tenant — super_admin only, for customer support.
//   GET                       -> [{ id, name, email, role, emailVerified, memberships[] }]
//   PATCH  { userId, ...patch} -> updated user (email / name / phone / emailVerified /
//                                 password / mobileAccess / isActive)
//   DELETE ?userId=...         -> remove the account

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    return jsonResponse({ success: true, data: await listOrganizationUsers(id) });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Lookup failed' }, 500);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) return jsonResponse({ success: false, error: 'userId is required' }, 400);

  const patch: UpdateOrgUserPatch = {};
  for (const k of ['email', 'name', 'password'] as const) {
    if (typeof body[k] === 'string') patch[k] = body[k];
  }
  if (body.phone === null || typeof body.phone === 'string') patch.phone = body.phone;
  for (const k of ['emailVerified', 'mobileAccess', 'isActive'] as const) {
    if (typeof body[k] === 'boolean') patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse({ success: false, error: 'Nothing to update' }, 400);
  }

  const result = await updateOrganizationUser(id, userId, patch);
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, result.status);
  return jsonResponse({ success: true, data: result.user });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const userId = request.nextUrl.searchParams.get('userId') ?? '';
  if (!userId) return jsonResponse({ success: false, error: 'userId is required' }, 400);

  const result = await removeOrganizationUser(id, userId);
  if (!result.ok) return jsonResponse({ success: false, error: result.error }, result.status);
  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('GET,PATCH,DELETE,OPTIONS');
}
