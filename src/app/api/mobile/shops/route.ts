import { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { isSupabaseAdminConfigured } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';

/**
 * GET /api/mobile/shops
 * Get list of shops accessible to the shopkeeper
 */
export async function GET(request: NextRequest) {
  try {
    const enableVerboseErrors = process.env.ENABLE_VERBOSE_ERRORS === 'true';
    // Quick config check to make misconfiguration obvious in logs/clients
    if (typeof window === 'undefined' && !isSupabaseAdminConfigured) {
      logger.error('Supabase admin client misconfigured', { endpoint: '/api/mobile/shops' });
      return jsonResponse({
        success: false,
        error: 'Server misconfiguration: database client not configured',
        code: 'SERVER_CONFIG_ERROR'
      }, 500);
    }
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return jsonResponse({ 
        success: false, 
        error: 'Unauthorized',
        code: 'UNAUTHORIZED'
      }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      return jsonResponse({ 
        success: false, 
        error: 'Invalid token',
        code: 'UNAUTHORIZED'
      }, 401);
    }

    // Get portal user to find their shop(s)
    const { data: portalUsers, error: portalError } = await supabaseAdmin
      .from('PortalUser')
      .select('shopId')
      .eq('userId', payload.userId);

    if (portalError || !portalUsers || portalUsers.length === 0) {
      logger.warn('Mobile shops list: no portal user found', { 
        userId: payload.userId,
        endpoint: '/api/mobile/shops'
      });
      return jsonResponse({
        success: true,
        data: { shops: [] }
      }, 200);
    }

    const shopIds = (portalUsers as Array<Record<string, unknown>>)
      .map(p => typeof p.shopId === 'string' || typeof p.shopId === 'number' ? String(p.shopId) : undefined)
      .filter(Boolean) as string[];

    // If there are no valid shop IDs, return empty list early
    if (!shopIds || shopIds.length === 0) {
      logger.info('Mobile shops list retrieved: no shops for user', {
        userId: payload.userId,
        shopCount: 0,
        endpoint: '/api/mobile/shops'
      });

      return jsonResponse({
        success: true,
        data: { shops: [] }
      }, 200);
    }

    // Get shop details. Use .eq for a single id (some clients / drivers behave better)
    let shops: Array<Record<string, unknown>> | null = null;
    try {
      if (shopIds.length === 1) {
        const { data, error } = await supabaseAdmin
          .from('Shop')
          // DB column is `phone` (snake/camel mismatch). Request `phone` and map to `phoneNumber` below.
          .select('id, name, location, phone, address')
          .eq('id', shopIds[0]);
        if (error) throw error;
        shops = data || [];
      } else {
        const { data, error } = await supabaseAdmin
          .from('Shop')
          .select('id, name, location, phone, address')
          .in('id', shopIds);
        if (error) throw error;
        shops = data || [];
      }
    } catch (shopsError: unknown) {
      // Log full error object to help debugging (avoid leaking to clients)
      logger.error('Mobile shops list error', {
        userId: payload.userId,
        error: shopsError instanceof Error ? shopsError.message : String(shopsError),
        rawError: shopsError,
        shopIds,
        endpoint: '/api/mobile/shops'
      });

      // In non-production environments include a little more debug detail to help
      // developers diagnose Supabase errors. Never leak raw errors in production.
      const debugInfo = enableVerboseErrors ? { message: shopsError instanceof Error ? shopsError.message : String(shopsError) } : undefined;

      return jsonResponse({
        success: false,
        error: 'Failed to fetch shops',
        code: 'INTERNAL_ERROR',
        debug: debugInfo
      }, 500);
    }

    logger.info('Mobile shops list retrieved', { 
      userId: payload.userId,
      shopCount: shops?.length || 0,
      endpoint: '/api/mobile/shops'
    });

    return jsonResponse({
      success: true,
      data: {
        shops: (shops || []).map((sRaw: Record<string, unknown>) => {
          const s = sRaw as Record<string, unknown>;
          const phoneVal = s['phone'];
          const fallbackPhoneVal = s['phoneNumber'];
          const phoneNumber = typeof phoneVal === 'string' ? phoneVal : (typeof fallbackPhoneVal === 'string' ? fallbackPhoneVal : null);

          return {
            id: typeof s['id'] === 'string' ? s['id'] : (typeof s['id'] === 'number' ? String(s['id']) : undefined),
            name: typeof s['name'] === 'string' ? s['name'] : undefined,
            location: typeof s['location'] === 'string' ? s['location'] : undefined,
            phoneNumber,
            address: typeof s['address'] === 'string' ? s['address'] : undefined,
          };
        })
      }
    }, 200);

  } catch (error) {
    logger.error('Mobile shops list error', { 
      error: error instanceof Error ? error.message : String(error),
      endpoint: '/api/mobile/shops'
    });
    const debugInfo = process.env.ENABLE_VERBOSE_ERRORS === 'true' ? { message: error instanceof Error ? error.message : String(error) } : undefined;
    return jsonResponse({ 
      success: false, 
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      debug: debugInfo
    }, 500);
  }
}

/**
 * OPTIONS handler for CORS
 */
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

