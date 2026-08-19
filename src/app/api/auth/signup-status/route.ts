import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getSelfSignupEnabled } from '@/lib/platform-settings.server';

// GET /api/auth/signup-status — public, no auth required. Lets the /signup
// page show a closed-state message without needing to be logged in.
export async function GET() {
  const enabled = await getSelfSignupEnabled();
  return jsonResponse({ success: true, data: { enabled } });
}

export function OPTIONS() {
  return optionsResponse('GET,OPTIONS');
}
