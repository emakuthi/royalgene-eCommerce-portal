'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useHydratedAuth } from '@/lib/hooks';
import { decodeJwt } from '@/lib/auth.client';

/**
 * Landing page for a subdomain that receives a token minted on a different
 * host (e.g. signup happens on the apex/marketing host, then the browser is
 * redirected here on the new tenant's own subdomain so the token lands in
 * that subdomain's localStorage, matching where it will actually be used).
 */
export default function SessionBridgePage() {
  return (
    <Suspense fallback={null}>
      <SessionBridgeInner />
    </Suspense>
  );
}

function SessionBridgeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth, mounted } = useHydratedAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mounted) return;

    const token = searchParams.get('token');
    if (!token) {
      setError('Missing session token');
      return;
    }

    const claims = decodeJwt(token);
    if (!claims || typeof claims.userId !== 'string') {
      setError('Invalid session token');
      return;
    }

    setAuth(
      {
        id: claims.userId,
        email: typeof claims.email === 'string' ? claims.email : '',
        name: searchParams.get('name') || '',
        role: (typeof claims.role === 'string' ? claims.role : 'admin') as 'admin' | 'portal_user' | 'customer' | 'super_admin',
        password: '',
        twoFactorEnabled: false,
        createdAt: new Date().toISOString(),
      },
      token,
    );

    router.replace('/dashboard');
  }, [mounted, searchParams, setAuth, router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 px-6 text-center">
      {error ? (
        <>
          <p className="text-destructive">{error}</p>
          <a href="/login" className="text-sm underline">Go to login</a>
        </>
      ) : (
        <p className="text-muted-foreground">Setting up your workspace…</p>
      )}
    </div>
  );
}
