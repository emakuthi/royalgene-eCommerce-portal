import { NextRequest, NextResponse } from 'next/server';
import { requireTenantUser } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { isDriveConfigured } from '@/lib/google-drive.server';
import { getDriveConnectionSummary } from '@/lib/receipts/drive-connection.server';
import { canManageReceipts } from '@/lib/receipts/receipts.server';

// GET /api/portal/integrations/google-drive/status — is receipts' Google Drive connected, and may this caller use receipts.
export async function GET(request: NextRequest) {
  const auth = requireTenantUser(request);
  if (auth instanceof NextResponse) return auth;
  const [summary, canManage] = await Promise.all([
    getDriveConnectionSummary(auth.organizationId as string),
    canManageReceipts(auth),
  ]);
  return jsonResponse({ success: true, data: { ...summary, configured: isDriveConfigured(), canManageReceipts: canManage, canConnect: auth.role === 'admin' || auth.role === 'super_admin' } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
