import Image from 'next/image';
import Link from 'next/link';
import { Store, Package, BarChart3, ShieldCheck, Building2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { listPlans } from '@/lib/billing-plans.server';

const FEATURES = [
  { icon: Store, label: 'Shop Management', desc: 'Manage all your shop locations in one place' },
  { icon: Package, label: 'Inventory Control', desc: 'Real-time stock tracking and low-stock alerts' },
  { icon: BarChart3, label: 'Sales Analytics', desc: 'Detailed insights and performance reports' },
  { icon: ShieldCheck, label: 'Secure Access', desc: 'Role-based access control for your whole team' },
  { icon: Building2, label: 'Multi-Shop, One Workspace', desc: 'Run every location from a single dashboard' },
];

function formatKes(kobo: number): string {
  return `KES ${(kobo / 100).toLocaleString('en-KE')}`;
}

export default async function LandingPage() {
  const plans = await listPlans(true);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-gray-100 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Royal Gene" width={32} height={32} className="object-contain" priority />
            <span className="font-bold text-gray-900 dark:text-white">Royal Gene Portal</span>
          </div>
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

      {/* Hero */}
      <section className="bg-gradient-to-br from-purple-900 via-purple-800 to-purple-700">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 py-20 sm:py-28 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white leading-tight">
            Run your retail business<br className="hidden sm:block" /> from one portal
          </h1>
          <p className="mt-5 text-lg text-purple-100 max-w-2xl mx-auto">
            Shop management, inventory, sales, and analytics for multi-location retail teams —
            set up your own workspace in minutes.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button size="lg" asChild className="bg-white text-purple-900 hover:bg-purple-50">
              <Link href="/signup">Start free</Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="border-white/40 text-white hover:bg-white/10">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          {FEATURES.map((f) => (
            <div key={f.label} className="flex flex-col gap-3">
              <div className="w-11 h-11 rounded-xl bg-[hsl(var(--primary)/0.1)] flex items-center justify-center">
                <f.icon className="h-5 w-5 text-[hsl(var(--primary))]" />
              </div>
              <p className="font-semibold text-gray-900 dark:text-white">{f.label}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-white">Simple, transparent pricing</h2>
            <p className="mt-3 text-gray-500 dark:text-gray-400">Start free, upgrade whenever you're ready — no commitment up front.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <div className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-gray-900 p-6 flex flex-col gap-4">
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">Free</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Everything you need to get started</p>
              </div>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">KES 0</p>
              <Button asChild className="mt-auto">
                <Link href="/signup">Start free</Link>
              </Button>
            </div>

            {plans.map((plan) => (
              <div key={plan.id} className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-gray-900 p-6 flex flex-col gap-4">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">{plan.name}</p>
                  {plan.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{plan.description}</p>}
                </div>
                <p className="text-3xl font-bold text-gray-900 dark:text-white">
                  {formatKes(plan.monthlyPriceKobo)}
                  <span className="text-sm font-normal text-gray-500 dark:text-gray-400">/mo</span>
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  or {formatKes(plan.annualPriceKobo)}/yr
                </p>
                {(plan.maxShops || plan.maxUsers) && (
                  <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-300">
                    {plan.maxShops && (
                      <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[hsl(var(--primary))]" /> Up to {plan.maxShops} shops</li>
                    )}
                    {plan.maxUsers && (
                      <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[hsl(var(--primary))]" /> Up to {plan.maxUsers} team members</li>
                    )}
                  </ul>
                )}
                <Button asChild variant="outline" className="mt-auto">
                  <Link href="/signup">Start free, upgrade anytime</Link>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
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
