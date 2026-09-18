/**
 * POST /api/mobile/crash-reports
 *
 * Self-hosted crash reporting for the Android app — there's no Play Store
 * (so no Play Console vitals) and no third-party crash SDK wired up, so a
 * fatal crash on a tenant's phone was otherwise invisible. The app persists
 * a crash to disk the moment it happens (the process is about to die, so no
 * network call there) and POSTs it here on its *next* launch instead.
 *
 * Intentionally minimal: no dashboard, no alerting, no symbolication — just
 * enough to query directly (Supabase) when investigating a report.
 */
import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

const MAX_STACK_TRACE_CHARS = 20_000;

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const stackTrace = typeof body?.stackTrace === 'string' ? body.stackTrace : null;
    if (!stackTrace) {
      return jsonResponse({ success: false, error: 'stackTrace is required' }, 400);
    }

    const occurredAtRaw = typeof body?.occurredAt === 'string' ? new Date(body.occurredAt) : null;
    const occurredAt = occurredAtRaw && !Number.isNaN(occurredAtRaw.getTime()) ? occurredAtRaw.toISOString() : new Date().toISOString();

    const { error } = await supabaseAdmin.from('CrashReport').insert([{
      organizationId: payload.organizationId ?? null,
      userId: payload.userId ?? null,
      platform: typeof body?.platform === 'string' ? body.platform : 'android',
      appVersionName: typeof body?.appVersionName === 'string' ? body.appVersionName : null,
      appVersionCode: typeof body?.appVersionCode === 'number' ? body.appVersionCode : null,
      deviceModel: typeof body?.deviceModel === 'string' ? body.deviceModel : null,
      osVersion: typeof body?.osVersion === 'string' ? body.osVersion : null,
      message: typeof body?.message === 'string' ? body.message.slice(0, 2000) : null,
      stackTrace: stackTrace.slice(0, MAX_STACK_TRACE_CHARS),
      occurredAt,
    }]);

    if (error) {
      logger.error('[crash-reports] insert failed', { error: error.message });
      return jsonResponse({ success: false, error: 'Failed to store crash report' }, 500);
    }

    return jsonResponse({ success: true });
  } catch (error) {
    logger.error('[crash-reports] unexpected error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('POST,OPTIONS');
}
