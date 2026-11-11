import { rejectIfDeactivated } from '@/lib/deactivated-staff.server';
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { dailyReportGet, dailyReportPut, dailyReportTest } from '@/lib/daily-report-routes.server';

// /api/mobile/settings/daily-report — the owner's WhatsApp end-of-day report. Workspace owner only.
async function owner(request: NextRequest): Promise<string | Response> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  const payload = token ? verifyToken(token) : null;
  if (!payload) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
  const deactivated = await rejectIfDeactivated(payload);
  if (deactivated) return deactivated;
  if (!payload.organizationId) return jsonResponse({ success: false, error: 'No workspace', code: 'FORBIDDEN' }, 403);
  if (payload.role !== 'admin' && payload.role !== 'super_admin') {
    return jsonResponse({ success: false, error: 'Only the workspace owner can change this', code: 'FORBIDDEN' }, 403);
  }
  return payload.organizationId;
}

export async function GET(request: NextRequest) {
  const org = await owner(request);
  return typeof org === 'string' ? dailyReportGet(org) : org;
}

// PUT { whatsapp } — "" turns it off.
export async function PUT(request: NextRequest) {
  const org = await owner(request);
  return typeof org === 'string' ? dailyReportPut(org, request) : org;
}

// POST — send today's report now as a test.
export async function POST(request: NextRequest) {
  const org = await owner(request);
  return typeof org === 'string' ? dailyReportTest(org) : org;
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,POST,OPTIONS');
}
