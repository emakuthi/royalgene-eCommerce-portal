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

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '30', 10)));
    const offset = (page - 1) * limit;
    const category = searchParams.get('category');

    let query = supabaseAdmin
      .from('activity_logs')
      .select('*', { count: 'exact' })
      .eq('user_id', payload.userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) query = query.eq('category', category);

    const { data, error, count } = await query;

    if (error) {
      logger.error('Mobile activity GET failed', { error: error.message, userId: payload.userId });
      return jsonResponse({ success: false, error: 'Failed to fetch activity' }, 500);
    }

    const logs = (data || []).map((row: Record<string, unknown>) => ({
      id: row.id,
      action: row.action,
      category: row.category,
      source: row.source,
      endpoint: row.endpoint,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      shopId: row.shop_id,
      deviceType: row.device_type,
      status: row.status,
      details: row.details,
      createdAt: row.created_at,
    }));

    const totalPages = count ? Math.ceil(count / limit) : 0;

    return jsonResponse({
      success: true,
      data: {
        logs,
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

