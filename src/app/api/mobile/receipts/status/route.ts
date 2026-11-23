import { NextRequest } from 'next/server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { isDriveConfigured } from '@/lib/google-drive.server';
import { getDriveConnectionSummary } from '@/lib/receipts/drive-connection.server';
import { canManageReceipts } from '@/lib/receipts/receipts.server';
import { mobileReceiptsAuth } from '@/lib/receipts/mobile-auth.server';

// GET /api/mobile/receipts/status — may this user use receipts, and is the owner's Google Drive connected.
// Connecting happens in the portal (Settings → Integrations), so the app only reads this.
export async function GET(request: NextRequest) {
  const auth = await mobileReceiptsAuth(request);
  if (auth instanceof Response) return auth;
  const [summary, canManage] = await Promise.all([
    getDriveConnectionSummary(auth.organizationId as string),
    canManageReceipts(auth),
  ]);
  return jsonResponse({
    success: true,
    data: {
      connected: summary.connected,
      needsReconnect: summary.needsReconnect,
      email: canManage ? summary.email : null,
      configured: isDriveConfigured(),
      canManageReceipts: canManage,
      canConnect: auth.role === 'admin' || auth.role === 'super_admin',
    },
  });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
