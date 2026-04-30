import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from './authorize';
import type { VerifiedPayload } from './auth';

/**
 * withAuth - wrapper for Next.js route handlers that require authentication.
 * handler receives (request, context, payload)
 */
export function withAuth<TContext extends Record<string, unknown>>(handler: (request: NextRequest, context: TContext, payload: VerifiedPayload) => Promise<NextResponse | Response | void> | NextResponse | Response | void) {
  return async (request: NextRequest, context: TContext): Promise<NextResponse | Response | undefined> => {
    const auth = requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const payload = auth as VerifiedPayload;
    const result = await handler(request, context, payload);
    return result ?? undefined;
  };
}

/**
 * withRole - wrapper that enforces allowed role(s) before calling handler
 */
export function withRole<TContext extends Record<string, unknown>>(allowed: string[], handler: (request: NextRequest, context: TContext, payload: VerifiedPayload) => Promise<NextResponse | Response | void> | NextResponse | Response | void) {
  return async (request: NextRequest, context: TContext): Promise<NextResponse | Response | undefined> => {
    const auth = requireRole(request, allowed);
    if (auth instanceof NextResponse) return auth;
    const payload = auth as VerifiedPayload;
    const result = await handler(request, context, payload);
    return result ?? undefined;
  };
}

