import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

/**
 * Deprecated: this route relied on a hardcoded invitation-code map and a
 * "first active shop" single-tenant fallback that don't make sense once the
 * app supports multiple organizations. Use POST /api/auth/signup (new
 * organization) or the org-scoped invitation flow via
 * POST /api/mobile/auth/register instead.
 */
export async function POST() {
  return jsonResponse(
    { success: false, error: 'This endpoint has been retired. Use /api/auth/signup instead.' },
    410,
  );
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
