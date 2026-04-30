import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Apply CORS to API routes
  if (pathname.startsWith('/api/')) {
    const origin = req.headers.get('origin') ?? undefined;

    try {
      console.info(`[portal-middleware] ${req.method} ${pathname} origin=${origin ?? 'none'}`);
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

    const response = NextResponse.next();
    return addCorsHeaders(response, origin);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};

