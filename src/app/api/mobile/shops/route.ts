import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { isValidClientId } from '@/lib/sync/syncable-entities';
import { idempotentInsert } from '@/lib/sync/idempotent-insert.server';
import { verifyToken } from '@/lib/auth.server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { isSupabaseAdminConfigured } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import { jsonResponse } from '@/lib/apiResponse';
import { assertCanCreate } from '@/lib/entitlements/enforce.server';
import { isShopNameAvailable } from '@/lib/shops.server';

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

    const isAdmin = payload.role === 'admin' || payload.role === 'super_admin';

    // Get shop details. Admins (and super_admin) see every shop in their org
    // (a true super_admin has no organizationId and retains cross-tenant
    // visibility, matching /api/portal/shops) rather than only shops they
    // happen to have an explicit PortalUser link to — mirrors the "For admin
    // users without a specific shop, fetch all shops they can manage" logic
    // already used at mobile login. Non-admin shopkeepers stay scoped to
    // whichever shop(s) their PortalUser record(s) link them to.
    // A platform super_admin has no tenant — no shops here (use the console).
    if (payload.role === 'super_admin' && !payload.organizationId) {
      return jsonResponse({ success: true, data: { shops: [] } }, 200);
    }

    let shops: Array<Record<string, unknown>> | null = null;
    try {
      if (isAdmin) {
        const shopsQuery = supabaseAdmin
          .from('Shop')
          .select('id, name, location, phone, address')
          .eq('isActive', true)
          .eq('organizationId', payload.organizationId)
          .order('name', { ascending: true });
        const { data, error } = await shopsQuery;
        if (error) throw error;
        shops = data || [];
      } else {
        // Get portal user to find their shop(s)
        const { data: portalUsers, error: portalError } = await supabaseAdmin
          .from('PortalUser')
          .select('shopId')
          .eq('userId', payload.userId);

        if (portalError) throw portalError;

        const shopIds = ((portalUsers ?? []) as Array<Record<string, unknown>>)
          .map(p => typeof p.shopId === 'string' || typeof p.shopId === 'number' ? String(p.shopId) : undefined)
          .filter(Boolean) as string[];

        if (shopIds.length === 0) {
          logger.info('Mobile shops list retrieved: no shops for user', {
            userId: payload.userId,
            shopCount: 0,
            endpoint: '/api/mobile/shops'
          });
          return jsonResponse({ success: true, data: { shops: [] } }, 200);
        }

        // Use .eq for a single id (some clients / drivers behave better)
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
      }
    } catch (shopsError: unknown) {
      // Log full error object to help debugging (avoid leaking to clients)
      logger.error('Mobile shops list error', {
        userId: payload.userId,
        error: shopsError instanceof Error ? shopsError.message : String(shopsError),
        rawError: shopsError,
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
 * POST /api/mobile/shops
 * Create a shop. Admin / super_admin only. Body: { name, location, phone?, address? }
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return jsonResponse({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    const payload = verifyToken(token);
    if (!payload) return jsonResponse({ success: false, error: 'Invalid token', code: 'UNAUTHORIZED' }, 401);

    if (payload.role !== 'admin' && payload.role !== 'super_admin') {
      return jsonResponse({ success: false, error: 'Only workspace admins can create shops', code: 'FORBIDDEN' }, 403);
    }
    if (!payload.organizationId) {
      return jsonResponse({ success: false, error: 'An organization context is required to create a shop', code: 'NO_ORGANIZATION' }, 400);
    }
    const organizationId = payload.organizationId;

    const limitResponse = await assertCanCreate(organizationId, 'BRANCH');
    if (limitResponse) return limitResponse;

    const body = await request.json().catch(() => ({}));
    const { name, location, phone, address } = body as { name?: string; location?: string; phone?: string; address?: string };

    if (!name?.trim() || !location?.trim()) {
      return jsonResponse({ success: false, error: 'Shop name and location are required', code: 'VALIDATION_ERROR' }, 400);
    }

    // Offline-first: the app may resend a create it already succeeded. If that
    // shop id exists (in this org), return it — don't trip the name check.
    const clientShopId = isValidClientId((body as { id?: unknown }).id) ? (body as { id: string }).id : null;
    if (clientShopId) {
      const { data: dup } = await supabaseAdmin
        .from('Shop').select('id, name, location, phone, address, organizationId').eq('id', clientShopId).maybeSingle();
      if (dup) {
        if (dup.organizationId !== organizationId) {
          return jsonResponse({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, 403);
        }
        return jsonResponse({
          success: true,
          data: { id: dup.id, name: dup.name, location: dup.location, phoneNumber: dup.phone ?? null, address: dup.address ?? null },
          idempotent: true,
        }, 200);
      }
    }

    if (!(await isShopNameAvailable(name.trim()))) {
      return jsonResponse({ success: false, error: 'A shop with that name already exists', code: 'DUPLICATE_NAME' }, 409);
    }

    const now = new Date().toISOString();
    const insert = await idempotentInsert<{ id: string; name: string; location: string; phone: string | null; address: string | null }>('Shop', {
      id: clientShopId ?? uuidv4(),
      organizationId,
      name: name.trim(),
      location: location.trim(),
      phone: phone?.trim() || null,
      address: address?.trim() || null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    if (!insert.ok) {
      if (insert.code === '23505') {
        return jsonResponse({ success: false, error: 'A shop with that name already exists', code: 'DUPLICATE_NAME' }, 409);
      }
      logger.error('Mobile create shop failed', { error: insert.error, userId: payload.userId });
      return jsonResponse({ success: false, error: 'Failed to create shop', code: 'INTERNAL_ERROR' }, 500);
    }
    const shop = insert.row;

    logger.info('Mobile shop created', { shopId: shop?.id, userId: payload.userId });
    return jsonResponse({
      success: true,
      data: {
        id: shop.id,
        name: shop.name,
        location: shop.location,
        phoneNumber: shop.phone ?? null,
        address: shop.address ?? null,
      },
    }, 201);
  } catch (error) {
    logger.error('Mobile create shop error', { error: error instanceof Error ? error.message : String(error) });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

