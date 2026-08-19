import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { listPlansWithEntitlements } from '@/lib/billing-plans.server';

// GET /api/plans — public plan catalog with entitlements, for the pricing page.
// Tenant-optional (see middleware.ts TENANT_OPTIONAL_PATHS) — pricing must be
// visible before anyone has signed up for a workspace.
export async function GET() {
  const plans = await listPlansWithEntitlements(true);
  return jsonResponse({ success: true, data: plans });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
