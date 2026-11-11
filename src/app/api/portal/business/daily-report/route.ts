import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { dailyReportGet, dailyReportPut, dailyReportTest } from '@/lib/daily-report-routes.server';

// /api/portal/business/daily-report — the owner's WhatsApp end-of-day report. Owner only.
function owner(request: NextRequest) {
  const auth = requireRole(request, ['admin']);
  if (auth instanceof NextResponse) return auth;
  if (!auth.organizationId) return jsonResponse({ success: false, error: 'No organization' }, 400);
  return auth.organizationId;
}

export async function GET(request: NextRequest) {
  const org = owner(request);
  return typeof org === 'string' ? dailyReportGet(org) : org;
}

// PUT { whatsapp } — "" turns it off.
export async function PUT(request: NextRequest) {
  const org = owner(request);
  return typeof org === 'string' ? dailyReportPut(org, request) : org;
}

// POST — send today's report now as a test.
export async function POST(request: NextRequest) {
  const org = owner(request);
  return typeof org === 'string' ? dailyReportTest(org) : org;
}

export function OPTIONS() {
  return optionsResponse('GET,PUT,POST,OPTIONS');
}
