/**
 * POST /api/mobile/activity
 * Mobile app sends activity events here (batch or single).
 *
 * GET  /api/mobile/activity
 * Mobile app fetches its own recent activity log.
 */

import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import {
  trackActivity,
  detectDeviceType,
  extractClientIp,
  type ActivityEvent,
} from '@/lib/activity-tracker';
import { assertFeatureEnabled } from '@/lib/entitlements/enforce.server';
import { FeatureCode } from '@/lib/entitlements/feature-codes';

// ─── POST: Record mobile activity events (single or batch) ─────────────────

export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);

    const body = await request.json() as { events?: ActivityEvent[]; event?: ActivityEvent };

    // Accept either a single event or an array of events
    const incoming: ActivityEvent[] = [];
    if (Array.isArray(body.events)) {
      incoming.push(...body.events);
    } else if (body.event) {
      incoming.push(body.event);
    } else {
      // Treat the entire body as a single event
      incoming.push(body as unknown as ActivityEvent);
    }

    if (incoming.length === 0 || !incoming[0]?.action) {
      return jsonResponse({ success: false, error: 'At least one activity event with an action is required' }, 400);
    }

    // Cap batch size
    const maxBatch = 50;
    const events = incoming.slice(0, maxBatch);

    const ua = request.headers.get('user-agent');
    const ip = extractClientIp(request);
    const device = detectDeviceType(ua);

    const results: Array<{ action: string; id: string | null }> = [];

    for (const evt of events) {
      const id = await trackActivity({
        ...evt,
        // Override identity fields from the verified token to prevent spoofing
        userId: payload.userId,
        userEmail: payload.email as string | undefined,
        userRole: payload.role,
        organizationId: payload.organizationId,
        source: 'mobile',
        ipAddress: ip,
        userAgent: ua,
        deviceType: device,
        // Let the client provide shopId, endpoint, etc.
        shopId: evt.shopId ?? (payload.shopId as string | undefined),
      });
      results.push({ action: evt.action, id });
    }

    logger.info('Mobile activity recorded', {
      userId: payload.userId,
      eventsReceived: events.length,
      endpoint: '/api/mobile/activity',
    });

    return jsonResponse({ success: true, data: { recorded: results.length, results } }, 201);
  } catch (error) {
    logger.error('Mobile activity POST error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

// ─── GET: Fetch the caller's own activity history ───────────────────────────

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);

    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);

    if (payload.organizationId) {
      const featureResponse = await assertFeatureEnabled(payload.organizationId, FeatureCode.AUDIT_TRAIL);
      if (featureResponse) return featureResponse;
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '30', 10)));
    const offset = (page - 1) * limit;
    const category = searchParams.get('category');

    // Admins/super_admins default to their whole team's activity (who logged
    // in, from where, doing what) — not just their own. `?scope=self` opts
    // back into the personal view. Everyone else always gets their own only.
    const isAdmin = payload.role === 'admin' || payload.role === 'super_admin';
    const wantsTeamScope = isAdmin && !!payload.organizationId && searchParams.get('scope') !== 'self';

    let orgUserIds: string[] | null = null;
    if (wantsTeamScope) {
      const { data: orgUsers, error: orgUsersError } = await supabaseAdmin
        .from('User')
        .select('id')
        .eq('organizationId', payload.organizationId);
      if (orgUsersError) {
        logger.error('Mobile activity GET: failed to resolve org members', { error: orgUsersError.message, organizationId: payload.organizationId });
        return jsonResponse({ success: false, error: 'Failed to fetch activity' }, 500);
      }
      orgUserIds = (orgUsers ?? []).map((u: { id: string }) => u.id);
    }

    let query = supabaseAdmin
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // `.in()` with an empty array matches nothing (not "no filter") — correct
    // here too: an org with zero resolvable members should show zero rows,
    // not fall through to every row in the table.
    query = orgUserIds ? query.in('user_id', orgUserIds) : query.eq('user_id', payload.userId);
    if (category) query = query.eq('category', category);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Mobile activity GET failed', { error: error.message, userId: payload.userId });
      return jsonResponse({ success: false, error: 'Failed to fetch activity' }, 500);
    }

    const rows = (data || []) as Array<Record<string, unknown>>;

    // Names aren't stored on activity_logs itself (only the email snapshot
    // is) — batch-resolve just the actors on THIS page, not the whole org.
    const actorIds = [...new Set(rows.map((r) => r.user_id).filter((v): v is string => typeof v === 'string'))];
    const nameByUserId = new Map<string, string | null>();
    if (actorIds.length > 0) {
      const { data: actors } = await supabaseAdmin.from('User').select('id, name').in('id', actorIds);
      for (const a of (actors ?? []) as Array<{ id: string; name: string | null }>) nameByUserId.set(a.id, a.name);
    }

    const logs = rows.map((row) => {
      const details = (row.details ?? {}) as Record<string, unknown>;
      const deviceName = typeof details.deviceName === 'string' && details.deviceName.trim() ? details.deviceName : null;
      const platform = typeof details.platform === 'string' ? details.platform : null;
      return {
        id: row.id,
        action: row.action,
        category: row.category,
        source: row.source,
        endpoint: row.endpoint,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        shopId: row.shop_id,
        userId: row.user_id,
        userName: typeof row.user_id === 'string' ? nameByUserId.get(row.user_id) ?? null : null,
        userEmail: row.user_email,
        deviceType: row.device_type,
        // The actual device (e.g. "Pixel 7"), when this event captured one — only
        // populated for logins going forward; falls back to null everywhere else,
        // and the UI falls back to the generic deviceType icon in that case.
        device: deviceName ? (platform ? `${deviceName} (${platform})` : deviceName) : null,
        status: row.status,
        details: row.details,
        createdAt: row.created_at,
      };
    });

    const totalPages = count ? Math.ceil(count / limit) : 0;

    return jsonResponse({
      success: true,
      data: {
        logs,
        scope: wantsTeamScope ? 'team' : 'self',
        pagination: { page, limit, total: count || 0, totalPages, hasMore: page < totalPages },
      },
    }, 200);
  } catch (error) {
    logger.error('Mobile activity GET error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}

