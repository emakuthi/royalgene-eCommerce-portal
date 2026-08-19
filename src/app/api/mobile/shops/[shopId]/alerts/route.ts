import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/mobile/shops/[shopId]/alerts
 * List alerts for the shop (paginated)
 *
 * POST /api/mobile/shops/[shopId]/alerts
 * Create a new alert for the shop
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);
    }

    // Verify shop access
    const { data: portalUser, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('id, shopId')
      .eq('userId', payload.userId)
      .eq('shopId', shopId)
      .single();

    if (portalError || !portalUser) {
      return jsonResponse({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? '20') || 20, 1), 100);
    const page = Math.max(Number(searchParams.get('page') ?? '1') || 1, 1);
    const unreadOnly = searchParams.get('unread') === 'true';
    const offset = (page - 1) * limit;

    let query = supabaseAdmin
      .from('Alert')
      .select('*', { count: 'exact' })
      .eq('shopId', shopId)
      .order('createdAt', { ascending: false })
      .range(offset, offset + limit - 1);

    if (unreadOnly) {
      query = query.eq('read', false);
    }

    const { data, error, count } = await query;

    if (error) {
      logger.error('Mobile alerts list error', { error: error.message, shopId });
      return jsonResponse({ success: false, error: 'Failed to fetch alerts', code: 'INTERNAL_ERROR' }, 500);
    }

    const total = typeof count === 'number' ? count : (data ? data.length : 0);
    const pages = Math.ceil(total / limit);

    logger.info('Mobile alerts listed', {
      userId: payload.userId,
      shopId,
      count: data?.length ?? 0,
      endpoint: `/api/mobile/shops/${shopId}/alerts`,
    });

    return jsonResponse({
      success: true,
      data: {
        alerts: data ?? [],
        pagination: { page, limit, total, pages },
      },
    }, 200);
  } catch (error) {
    logger.error('Mobile alerts list error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/alerts',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ shopId: string }> }
) {
  try {
    const { shopId } = await context.params;
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);
    }

    // Verify shop access
    const { data: portalUser, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('id, shopId, organizationId')
      .eq('userId', payload.userId)
      .eq('shopId', shopId)
      .single();

    if (portalError || !portalUser) {
      return jsonResponse({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }

    const { title, message, level } = await request.json();

    if (!title && !message) {
      return jsonResponse({
        success: false,
        error: 'Title or message is required',
        code: 'VALIDATION_ERROR',
      }, 400);
    }

    const now = new Date().toISOString();
    const record: Record<string, unknown> = {
      id: uuidv4(),
      organizationId: portalUser.organizationId,
      title: title ?? null,
      message: message ?? null,
      level: level ?? 'info',
      read: false,
      shopId,
      portalUserId: portalUser.id,
      createdAt: now,
      updatedAt: now,
    };

    const { data, error } = await supabaseAdmin
      .from('Alert')
      .insert([record])
      .select()
      .single();

    if (error) {
      logger.error('Mobile alert creation failed', { error: error.message, shopId });
      return jsonResponse({ success: false, error: 'Failed to create alert', code: 'INTERNAL_ERROR' }, 500);
    }

    logger.info('Mobile alert created', {
      userId: payload.userId,
      shopId,
      alertId: data?.id,
      endpoint: `/api/mobile/shops/${shopId}/alerts`,
    });

    return jsonResponse({ success: true, data }, 201);
  } catch (error) {
    logger.error('Mobile alert creation error', {
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops/[shopId]/alerts',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

/** OPTIONS handler for CORS */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

