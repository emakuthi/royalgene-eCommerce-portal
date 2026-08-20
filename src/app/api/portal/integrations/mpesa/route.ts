import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { assertFeatureEnabled } from '@/lib/entitlements/enforce.server';
import { FeatureCode } from '@/lib/entitlements/feature-codes';
import { getMpesaConfigSummary, removeMpesaConfig, setMpesaConfig } from '@/lib/integrations/tenant-integration-config.server';

// GET /api/portal/integrations/mpesa — masked config summary, any authenticated org member.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const summary = await getMpesaConfigSummary(auth.organizationId);
  return jsonResponse({ success: true, data: summary });
}

// POST /api/portal/integrations/mpesa — set/replace this org's M-Pesa credentials. Org admin only.
export async function POST(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  const featureResponse = await assertFeatureEnabled(auth.organizationId, FeatureCode.MPESA_INTEGRATION);
  if (featureResponse) return featureResponse;

  const body = await request.json();
  const { consumerKey, consumerSecret, businessShortCode, passkey, environment, callbackUrl } = body || {};

  if (!consumerKey || !consumerSecret || !businessShortCode || !passkey || !callbackUrl) {
    return jsonResponse({ success: false, error: 'consumerKey, consumerSecret, businessShortCode, passkey, and callbackUrl are required' }, 400);
  }
  if (environment !== 'sandbox' && environment !== 'production') {
    return jsonResponse({ success: false, error: "environment must be 'sandbox' or 'production'" }, 400);
  }

  try {
    await setMpesaConfig(
      auth.organizationId,
      { consumerKey, consumerSecret, businessShortCode, passkey, environment, callbackUrl },
      auth.userId,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save M-Pesa configuration';
    const isEncryptionUnconfigured = message.includes('CREDENTIALS_ENCRYPTION_KEY');
    return jsonResponse(
      { success: false, error: isEncryptionUnconfigured ? 'Credential storage is not configured yet. Contact your platform administrator.' : message },
      isEncryptionUnconfigured ? 503 : 500,
    );
  }

  const summary = await getMpesaConfigSummary(auth.organizationId);
  return jsonResponse({ success: true, data: summary });
}

// DELETE /api/portal/integrations/mpesa — remove this org's stored credentials. Org admin only.
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;

  if (!auth.organizationId) {
    return jsonResponse({ success: false, error: 'No organization on this account' }, 400);
  }

  try {
    await removeMpesaConfig(auth.organizationId);
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to remove M-Pesa configuration' }, 500);
  }

  return jsonResponse({ success: true });
}

export function OPTIONS() {
  return optionsResponse('GET,POST,DELETE,OPTIONS');
}
