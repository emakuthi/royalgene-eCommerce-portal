import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { requireAuth } from '@/lib/authorize';
import logger from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { assertCanCreate } from '@/lib/entitlements/enforce.server';
import { isShopNameAvailable } from '@/lib/shops.server';

export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    let query = supabaseAdmin.from('Shop').select('*').eq('isActive', true).order('name', { ascending: true });
    // super_admin (no organizationId) retains cross-tenant visibility; every other
    // caller is scoped to their own organization.
    if (auth.organizationId) {
      query = query.eq('organizationId', auth.organizationId);
    }
    const { data: shops, error } = await query;

    if (error) {
      logger.error('Portal fetch shops failed (supabase)', { error: error.message, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Failed to fetch shops' }, 500);
    }

    logger.info('Portal shops fetched', { count: shops?.length || 0, userId: auth.userId, endpoint: '/api/portal/shops' });

    return jsonResponse({ success: true, data: shops || [] }, 200);
  } catch (err) {
    logger.error('Portal shops fetch error', { error: err instanceof Error ? err.message : String(err), endpoint: '/api/portal/shops' });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (!auth.organizationId) {
      // super_admin has no organization of their own — creating a shop
      // without a target org would produce an unowned, unreachable row.
      return jsonResponse({ success: false, error: 'An organization context is required to create a shop' }, 400);
    }
    const organizationId = auth.organizationId;

    const limitResponse = await assertCanCreate(organizationId, 'BRANCH');
    if (limitResponse) return limitResponse;

    const body = await request.json();
    const { name, location, phone, email } = body || {};

    logger.info('Portal create shop attempt', { userId: auth.userId, name, location, endpoint: '/api/portal/shops' });

    if (!name || !location) {
      logger.warn('Portal create shop failed: missing fields', { userId: auth.userId, name, location, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Shop name and location are required' }, 400);
    }

    // Shop names must be globally unique, not just within this organization.
    if (!(await isShopNameAvailable(name))) {
      logger.warn('Portal create shop failed: duplicate name', { userId: auth.userId, name, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'A shop with that name already exists' }, 409);
    }

    const shopId = uuidv4();
    const now = new Date();

    interface ShopInsert {
      id: string;
      organizationId: string;
      name: string;
      location: string;
      phone: string | null;
      email: string | null;
      manager: string | null;
      description: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }

    const insertPayload: ShopInsert = {
      id: shopId,
      organizationId,
      name,
      location,
      phone: phone || null,
      email: email || null,
      manager: null,
      description: null,
      isActive: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    const { data: shop, error } = await supabaseAdmin
      .from('Shop')
      .insert([insertPayload])
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        logger.warn('Portal create shop failed: duplicate name (race)', { userId: auth.userId, name, endpoint: '/api/portal/shops' });
        return jsonResponse({ success: false, error: 'A shop with that name already exists' }, 409);
      }
      logger.error('Portal create shop failed (supabase)', { error: error.message, userId: auth.userId, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Failed to create shop' }, 500);
    }

    logger.info('Portal shop created', { shopId: shop?.id, userId: auth.userId, endpoint: '/api/portal/shops', duration: Date.now() - startTime });

    return jsonResponse({ success: true, data: shop }, 201);
  } catch (err) {
    logger.error('Portal shop create error', { error: err instanceof Error ? err.message : String(err), endpoint: '/api/portal/shops', duration: Date.now() - startTime });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
