import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  DEV_TENANT_SLUG,
  extractSubdomain,
  isRootDomainHost,
  resolveOrganizationByCustomDomainEdge,
  resolveOrganizationEdge,
  type ResolvedOrganization,
} from '@/lib/tenant';

// Paths that must work even when no tenant has been resolved yet (signup,
// email verification, and the tenant-status pages themselves).
const TENANT_OPTIONAL_PATHS = [
  '/api/auth/signup',
  '/api/auth/signup-status',
  '/api/auth/check-slug',
  '/api/auth/verify-email',
  '/signup',
  '/verify-email',
  '/tenant-not-found',
  '/tenant-suspended',
  '/api/health',
  '/api/webhooks/paystack',
];

function isTenantOptional(pathname: string): boolean {
  return TENANT_OPTIONAL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

const DEFAULT_CORS = {
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
  'Access-Control-Allow-Credentials': 'true',
};

function addCorsHeaders(response: NextResponse, originHeader?: string) {
  const raw = process.env.ALLOWED_ORIGINS || '';
  const allowed = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null;

  const originToSet = (() => {
    if (!allowed) return '*';
    if (!originHeader) return undefined;
    return allowed.includes(originHeader) ? originHeader : undefined;
  })();

  if (originToSet !== undefined) {
    response.headers.set('Access-Control-Allow-Origin', originToSet);
  }

  for (const [k, v] of Object.entries(DEFAULT_CORS)) {
    response.headers.set(k, v);
  }
  return response;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApiRoute = pathname.startsWith('/api/');

  // --- Tenant resolution ---------------------------------------------------
  const host = req.headers.get('host');
  const subdomainSlug = extractSubdomain(host);
  let org: ResolvedOrganization | null;
  if (subdomainSlug) {
    org = await resolveOrganizationEdge(subdomainSlug);
  } else if (isRootDomainHost(host)) {
    // Bare apex / www / portal / other reserved host -> default tenant.
    org = await resolveOrganizationEdge(DEV_TENANT_SLUG);
  } else {
    // Not our root domain and not a recognized subdomain -> only remaining
    // possibility is a tenant's verified custom domain.
    org = host ? await resolveOrganizationByCustomDomainEdge(host) : null;
  }

  if (!org) {
    if (isTenantOptional(pathname)) {
      // No tenant required for this path — fall through without org headers.
    } else if (isApiRoute) {
      return new NextResponse(JSON.stringify({ success: false, error: 'Unknown organization' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      return NextResponse.rewrite(new URL('/tenant-not-found', req.url));
    }
  } else if (org.status === 'suspended' || org.status === 'cancelled') {
    if (!isTenantOptional(pathname)) {
      if (isApiRoute) {
        return new NextResponse(JSON.stringify({ success: false, error: 'Organization suspended' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return NextResponse.rewrite(new URL('/tenant-suspended', req.url));
    }
  }

  // Build the outgoing request headers. Always overwrite (never merge) so a
  // client can never spoof x-org-id/x-org-slug themselves — only middleware
  // (host-resolved) ever sets these.
  const forwardedHeaders = new Headers(req.headers);
  if (org) {
    forwardedHeaders.set('x-org-id', org.id);
    forwardedHeaders.set('x-org-slug', org.slug);
  } else {
    forwardedHeaders.delete('x-org-id');
    forwardedHeaders.delete('x-org-slug');
  }

  // --- CORS (API routes only, unchanged behavior) ---------------------------
  if (isApiRoute) {
    const origin = req.headers.get('origin') ?? undefined;

    try {
      console.info(`[portal-middleware] ${req.method} ${pathname} origin=${origin ?? 'none'} org=${org?.slug ?? 'none'}`);
    } catch (_e) {
      /* ignore */
    }

    if (req.method === 'OPTIONS') {
      const raw = process.env.ALLOWED_ORIGINS || '';
      const allowed = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : null;
      if (allowed && origin && !allowed.includes(origin)) {
        return new NextResponse(null, { status: 403 });
      }
      const res = new NextResponse(null, { status: 204 });
      return addCorsHeaders(res, origin);
    }

    const response = NextResponse.next({ request: { headers: forwardedHeaders } });
    return addCorsHeaders(response, origin);
  }

  return NextResponse.next({ request: { headers: forwardedHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

