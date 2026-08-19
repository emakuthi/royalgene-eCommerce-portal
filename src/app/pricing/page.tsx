import Image from 'next/image';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { listPlansWithEntitlements } from '@/lib/billing-plans.server';
import { PricingSection } from '@/components/entitlements/PricingSection';

export default async function PricingPage() {
  const plans = await listPlansWithEntitlements(true);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      <header className="sticky top-0 z-40 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link href="/">
            <Image src="/logo.png" alt="Royal Gene Portal" width={163} height={50} className="object-contain h-10 w-auto" priority />
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild className="bg-[hsl(var(--primary))] hover:brightness-90 text-white">
              <Link href="/signup">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 dark:text-white">Simple, transparent pricing</h1>
          <p className="mt-3 text-gray-500 dark:text-gray-400">Start free, upgrade whenever you&apos;re ready — no commitment up front.</p>
        </div>
        <PricingSection plans={plans} />
      </section>

      <footer className="mx-auto max-w-6xl px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500 dark:text-gray-400">
        <p>© {new Date().getFullYear()} Royal Gene Portal. All rights reserved.</p>
        <div className="flex items-center gap-4">
          <Link href="/login" className="hover:text-[hsl(var(--primary))]">Sign in</Link>
          <Link href="/signup" className="hover:text-[hsl(var(--primary))]">Get Started</Link>
        </div>
      </footer>
    </div>
  );
}
