import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { restoreOrganization } from '@/lib/organizations.server';

// POST /api/platform/organizations/[id]/restore — undo a soft-delete. super_admin only.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;

  try {
    const org = await restoreOrganization(id);
    if (!org) return jsonResponse({ success: false, error: 'No soft-deleted organization with that id' }, 404);
    return jsonResponse({ success: true, data: org });
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Restore failed' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
