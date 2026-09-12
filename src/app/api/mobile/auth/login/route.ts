import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-client';
import logger from '@/lib/logger';
import bcrypt from 'bcryptjs';
import { jsonResponse } from '@/lib/apiResponse';
import { buildMobileAuthResponse } from '@/lib/mobile-auth-response.server';
import { deviceInfoFromBody } from '@/lib/device-registry.server';
import { trackActivity, extractClientIp, detectDeviceType } from '@/lib/activity-tracker';

/**
 * POST /api/mobile/auth/login
 *
 * Email + password -> JWT plus the workspace the account belongs to. Email is
 * globally unique across workspaces, so the request host is irrelevant: the
 * app posts here on the shared root host and the response tells it which
 * workspace to point itself at.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { email, password } = body;
    const device = deviceInfoFromBody(body);

    if (!email || !password) {
      logger.warn('Mobile login failed: missing credentials', {
        endpoint: '/api/mobile/auth/login', hasEmail: !!email, hasPassword: !!password,
      });
      return jsonResponse({ success: false, error: 'Email and password are required', code: 'VALIDATION_ERROR' }, 400);
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: candidates, error: userError } = await supabaseAdmin
      .from('User')
      .select('*')
      .eq('email', normalizedEmail);

    if (userError) {
      logger.error('Mobile login: user lookup failed', { error: userError.message, endpoint: '/api/mobile/auth/login' });
      return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
    }

    // Verify the password against every account on this email (normally one;
    // >1 only for legacy accounts predating the unique-email constraint).
    const matched: Array<Record<string, unknown>> = [];
    for (const candidate of (candidates ?? []) as Array<Record<string, unknown>>) {
      const hash = typeof candidate.password === 'string' ? candidate.password : '';
      if (hash && (await bcrypt.compare(password, hash))) matched.push(candidate);
    }

    if (matched.length === 0) {
      logger.warn('Mobile login failed: no account / bad password', { email: normalizedEmail, endpoint: '/api/mobile/auth/login' });
      return jsonResponse({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' }, 401);
    }

    if (matched.length > 1) {
      const orgIds = [...new Set(matched.map((u) => u.organizationId).filter((v): v is string => typeof v === 'string'))];
      const { data: orgs } = await supabaseAdmin.from('Organization').select('id, name, slug').in('id', orgIds);
      logger.warn('Mobile login: email maps to multiple workspaces', { email: normalizedEmail, count: matched.length });
      return jsonResponse({
        success: false,
        code: 'MULTIPLE_WORKSPACES',
        error: 'This email is registered to more than one workspace. Contact support so we can merge them.',
        data: { workspaces: (orgs ?? []).map((o) => ({ organizationId: o.id, name: o.name, slug: o.slug })) },
      }, 409);
    }

    const user = matched[0] as { id: string; email: string; role: string };

    const result = await buildMobileAuthResponse(user.id, device);
    if (!result.ok) {
      void trackActivity({
        userId: user.id, userEmail: user.email, userRole: user.role,
        action: 'auth.login_failed', category: 'auth', source: 'mobile',
        endpoint: '/api/mobile/auth/login', httpMethod: 'POST',
        ipAddress: extractClientIp(request), userAgent: request.headers.get('user-agent'),
        deviceType: detectDeviceType(request.headers.get('user-agent')),
        status: 'failure', errorMessage: result.error,
      });
      const code = result.error.toLowerCase().includes('disabled') ? 'MOBILE_ACCESS_DISABLED' : 'FORBIDDEN';
      return jsonResponse({ success: false, error: result.error, code }, 403);
    }

    const duration = Date.now() - startTime;
    void trackActivity({
      userId: user.id, userEmail: result.data.user.email, userRole: result.data.user.role,
      action: 'auth.login', category: 'auth', source: 'mobile',
      endpoint: '/api/mobile/auth/login', httpMethod: 'POST',
      shopId: result.data.shop?.id ?? undefined,
      ipAddress: extractClientIp(request), userAgent: request.headers.get('user-agent'),
      deviceType: detectDeviceType(request.headers.get('user-agent')),
      status: 'success', durationMs: duration,
      details: { shopCount: result.data.shops?.length ?? (result.data.shop ? 1 : 0) },
    });

    logger.info('Mobile login successful', {
      userId: user.id, email: normalizedEmail, role: result.data.user.role, duration, endpoint: '/api/mobile/auth/login',
    });

    return jsonResponse({ success: true, data: result.data, message: 'Login successful' }, 200);
  } catch (error) {
    logger.error('Mobile login error', {
      error: error instanceof Error ? error.message : String(error), endpoint: '/api/mobile/auth/login',
    });
    return jsonResponse({ success: false, error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
}

/**
 * OPTIONS handler for CORS
 */
export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
