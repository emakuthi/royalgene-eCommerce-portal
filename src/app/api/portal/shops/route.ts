import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import { verifyToken } from '@/lib/auth.server';
import logger from '@/lib/logger';
import { v4 as uuidv4 } from 'uuid';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      logger.warn('Portal fetch shops unauthorized: no token', { endpoint: '/api/portal/shops', method: 'GET' });
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      logger.warn('Portal fetch shops unauthorized: invalid token', { endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    // Fetch all active shops
    const { data: shops, error } = await supabaseAdmin
      .from('Shop')
      .select('*')
      .eq('isActive', true)
      .order('name', { ascending: true });

    if (error) {
      logger.error('Portal fetch shops failed (supabase)', { error: error.message, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Failed to fetch shops' }, 500);
    }

    logger.info('Portal shops fetched', { count: shops?.length || 0, userId: payload.userId, endpoint: '/api/portal/shops' });

    return jsonResponse({ success: true, data: shops || [] }, 200);
  } catch (err) {
    logger.error('Portal shops fetch error', { error: err instanceof Error ? err.message : String(err), endpoint: '/api/portal/shops' });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      logger.warn('Portal create shop unauthorized: no token', { endpoint: '/api/portal/shops', method: 'POST' });
      return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
    }

    const payload = verifyToken(token);
    if (!payload) {
      logger.warn('Portal create shop unauthorized: invalid token', { endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Invalid token' }, 401);
    }

    const body = await request.json();
    const { name, location, phone, email } = body || {};

    logger.info('Portal create shop attempt', { userId: payload.userId, name, location, endpoint: '/api/portal/shops' });

    if (!name || !location) {
      logger.warn('Portal create shop failed: missing fields', { userId: payload.userId, name, location, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Shop name and location are required' }, 400);
    }

    // Optional: prevent duplicate shop names
    const { data: existing } = await supabaseAdmin
      .from('Shop')
      .select('id')
      .ilike('name', name)
      .limit(1)
      .single();

    if (existing) {
      logger.warn('Portal create shop failed: duplicate name', { userId: payload.userId, name, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'A shop with that name already exists' }, 409);
    }

    const shopId = uuidv4();
    const now = new Date();

    // Define a concrete type for the insert payload to avoid `any` and satisfy lint rules
    interface ShopInsert {
      id: string;
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
      logger.error('Portal create shop failed (supabase)', { error: error.message, userId: payload.userId, endpoint: '/api/portal/shops' });
      return jsonResponse({ success: false, error: 'Failed to create shop' }, 500);
    }

    logger.info('Portal shop created', { shopId: shop?.id, userId: payload.userId, endpoint: '/api/portal/shops', duration: Date.now() - startTime });

    return jsonResponse({ success: true, data: shop }, 201);
  } catch (err) {
    logger.error('Portal shop create error', { error: err instanceof Error ? err.message : String(err), endpoint: '/api/portal/shops', duration: Date.now() - startTime });
    return jsonResponse({ success: false, error: 'Internal server error' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
