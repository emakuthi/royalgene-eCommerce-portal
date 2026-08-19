'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const ok = searchParams.get('ok') === 'true';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      {ok ? (
        <>
          <CheckCircle2 className="h-10 w-10 text-green-600" />
          <h1 className="text-2xl font-semibold">Email verified</h1>
          <p className="max-w-md text-muted-foreground">Your workspace is ready to go.</p>
        </>
      ) : (
        <>
          <XCircle className="h-10 w-10 text-destructive" />
          <h1 className="text-2xl font-semibold">Verification link invalid or expired</h1>
          <p className="max-w-md text-muted-foreground">
            Please sign in and request a new verification email from your account settings.
          </p>
        </>
      )}
      <Link href="/login" className="mt-2 text-sm underline">Go to login</Link>
    </div>
  );
}
