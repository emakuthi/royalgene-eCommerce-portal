/**
 * Activity Tracker — Comprehensive user activity logging for web, portal, and mobile.
 *
 * Usage:
 *   import { trackActivity } from '@/lib/activity-tracker';
 *   await trackActivity({ userId, action: 'product.create', category: 'product', source: 'portal', ... });
 *
 * Or use the middleware wrapper:
 *   import { withActivityTracking } from '@/lib/activity-tracker';
 *   export const POST = withActivityTracking('/api/portal/sales', 'sale.record', 'sale', handler);
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase-client';
import logger from './logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ActivitySource = 'web' | 'portal' | 'mobile' | 'system';
export type ActivityStatus = 'success' | 'failure' | 'denied';
export type ActivityCategory =
  | 'auth'
  | 'product'
  | 'sale'
  | 'stock'
  | 'order'
  | 'settings'
  | 'admin'
  | 'shop'
  | 'payment'
  | 'general';

export interface ActivityEvent {
  /** User who performed the action (null for anonymous / system) */
  userId?: string | null;
  userEmail?: string | null;
  userRole?: string | null;

  /** Action identifier — use dot-notation: e.g. 'product.create', 'auth.login' */
  action: string;
  /** High-level category for filtering dashboards */
  category?: ActivityCategory;

  /** Where the action originated */
  source?: ActivitySource;
  endpoint?: string;
  httpMethod?: string;

  /** What resource was affected */
  resourceType?: string;
  resourceId?: string;

  /** Context */
  shopId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceType?: 'desktop' | 'mobile' | 'tablet' | 'api' | null;

  /** Extra metadata */
  details?: Record<string, unknown>;
  status?: ActivityStatus;
  errorMessage?: string | null;
  durationMs?: number | null;
}

export interface ActivityLog extends ActivityEvent {
  id: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Detect device type from user-agent string */
export function detectDeviceType(ua: string | null | undefined): 'desktop' | 'mobile' | 'tablet' | 'api' {
  if (!ua) return 'api';
  const lower = ua.toLowerCase();
  if (/tablet|ipad|playbook|silk/i.test(lower)) return 'tablet';
  if (/mobile|iphone|ipod|android(?!.*tablet)|windows phone|blackberry/i.test(lower)) return 'mobile';
  if (/bot|crawl|spider|curl|wget|postman|insomnia/i.test(lower)) return 'api';
  return 'desktop';
}

/** Extract client IP from Next.js request */
export function extractClientIp(request: NextRequest): string | null {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    null
  );
}

/** Detect source from the URL path */
export function detectSource(pathname: string): ActivitySource {
  if (pathname.startsWith('/api/mobile')) return 'mobile';
  if (pathname.startsWith('/api/portal')) return 'portal';
  if (pathname.startsWith('/api/admin')) return 'portal';
  return 'web';
}

// ─── Core Tracker ────────────────────────────────────────────────────────────

/**
 * Record a user activity event. Fire-and-forget by default (non-blocking).
 * Returns the inserted row id on success, or null on failure.
 */
export async function trackActivity(event: ActivityEvent): Promise<string | null> {
  try {
    const row = {
      user_id: event.userId || null,
      user_email: event.userEmail || null,
      user_role: event.userRole || null,
      action: event.action,
      category: event.category || 'general',
      source: event.source || 'web',
      endpoint: event.endpoint || null,
      http_method: event.httpMethod || null,
      resource_type: event.resourceType || null,
      resource_id: event.resourceId || null,
      shop_id: event.shopId || null,
      ip_address: event.ipAddress || null,
      user_agent: event.userAgent ? event.userAgent.slice(0, 512) : null,
      device_type: event.deviceType || null,
      details: event.details || {},
      status: event.status || 'success',
      error_message: event.errorMessage || null,
      duration_ms: event.durationMs ?? null,
    };

    const { data, error } = await supabaseAdmin
      .from('activity_logs')
      .insert([row])
      .select('id')
      .maybeSingle();

    if (error) {
      logger.warn('Activity tracking insert failed', { error: error.message, action: event.action });
      return null;
    }

    return (data as Record<string, unknown> | null)?.id as string ?? null;
  } catch (err) {
    // Activity tracking should never break the main flow
    logger.warn('Activity tracking error', { error: err instanceof Error ? err.message : String(err), action: event.action });
    return null;
  }
}

/**
 * Convenience: track from a NextRequest + verified payload.
 * Automatically extracts IP, user-agent, device type, and source.
 */
export function trackFromRequest(
  request: NextRequest,
  payload: { userId?: string; email?: string; role?: string; shopId?: string } | null,
  event: Omit<ActivityEvent, 'userId' | 'userEmail' | 'userRole' | 'ipAddress' | 'userAgent' | 'deviceType' | 'source' | 'endpoint' | 'httpMethod'>
): Promise<string | null> {
  const ua = request.headers.get('user-agent');
  const url = new URL(request.url);

  return trackActivity({
    ...event,
    userId: payload?.userId,
    userEmail: payload?.email,
    userRole: payload?.role,
    shopId: event.shopId ?? payload?.shopId,
    source: detectSource(url.pathname),
    endpoint: url.pathname,
    httpMethod: request.method,
    ipAddress: extractClientIp(request),
    userAgent: ua,
    deviceType: detectDeviceType(ua),
  });
}

// ─── Middleware Wrapper ──────────────────────────────────────────────────────

type RouteHandler = (request: NextRequest) => Promise<NextResponse | Response>;

/**
 * Wrap an API route handler with automatic activity tracking.
 * Logs the action after the handler completes (success or failure).
 *
 * @param endpoint  — e.g. '/api/portal/products'
 * @param action    — e.g. 'product.create'
 * @param category  — e.g. 'product'
 * @param handler   — the original route handler
 * @param opts      — optional overrides
 */
export function withActivityTracking(
  endpoint: string,
  action: string,
  category: ActivityCategory,
  handler: RouteHandler,
  opts?: {
    /** Extract resource info from the response body */
    extractResource?: (body: Record<string, unknown>) => { resourceType?: string; resourceId?: string; details?: Record<string, unknown> };
    source?: ActivitySource;
  }
): RouteHandler {
  return async (request: NextRequest) => {
    const startTime = Date.now();
    let response: NextResponse | Response;

    try {
      response = await handler(request);
    } catch (err) {
      // Track the failure, then re-throw
      const ua = request.headers.get('user-agent');
      void trackActivity({
        action,
        category,
        source: opts?.source ?? detectSource(endpoint),
        endpoint,
        httpMethod: request.method,
        ipAddress: extractClientIp(request),
        userAgent: ua,
        deviceType: detectDeviceType(ua),
        status: 'failure',
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      });
      throw err;
    }

    // Non-blocking: parse the response to extract info for the log
    const durationMs = Date.now() - startTime;
    const cloned = response.clone();
    void (async () => {
      try {
        const body = (await cloned.json()) as Record<string, unknown>;
        const status: ActivityStatus = (response as Response).status < 400 ? 'success' : 'failure';
        const ua = request.headers.get('user-agent');

        let resourceInfo: { resourceType?: string; resourceId?: string; details?: Record<string, unknown> } = {};
        if (opts?.extractResource) {
          try { resourceInfo = opts.extractResource(body); } catch { /* ignore */ }
        }

        void trackActivity({
          action,
          category,
          source: opts?.source ?? detectSource(endpoint),
          endpoint,
          httpMethod: request.method,
          ipAddress: extractClientIp(request),
          userAgent: ua,
          deviceType: detectDeviceType(ua),
          status,
          errorMessage: status === 'failure' ? (typeof body.error === 'string' ? body.error : null) : null,
          durationMs,
          ...resourceInfo,
        });
      } catch {
        // parsing failure — still fire a basic log
        void trackActivity({
          action,
          category,
          source: opts?.source ?? detectSource(endpoint),
          endpoint,
          httpMethod: request.method,
          durationMs,
          status: (response as Response).status < 400 ? 'success' : 'failure',
        });
      }
    })();

    return response;
  };
}

