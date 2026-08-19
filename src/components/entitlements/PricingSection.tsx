'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { PlanWithEntitlements } from '@/lib/billing-plans.server';
import { PlanComparison } from './PlanComparison';

/** Shared by the landing page's pricing section and the standalone /pricing route. */
export function PricingSection({ plans }: { plans: PlanWithEntitlements[] }) {
  const router = useRouter();
  const [interval, setInterval] = useState<'monthly' | 'annually'>('monthly');
  const [currency, setCurrency] = useState<'KES' | 'USD'>('KES');

  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
        <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] p-1">
          <Button variant={interval === 'monthly' ? 'default' : 'ghost'} size="sm" className="rounded-full" onClick={() => setInterval('monthly')}>
            Monthly
          </Button>
          <Button variant={interval === 'annually' ? 'default' : 'ghost'} size="sm" className="rounded-full" onClick={() => setInterval('annually')}>
            Annual
          </Button>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[hsl(var(--border))] p-1">
          <Button variant={currency === 'KES' ? 'default' : 'ghost'} size="sm" className="rounded-full" onClick={() => setCurrency('KES')}>
            KES
          </Button>
          <Button variant={currency === 'USD' ? 'default' : 'ghost'} size="sm" className="rounded-full" onClick={() => setCurrency('USD')}>
            USD
          </Button>
        </div>
      </div>
      {currency === 'USD' && (
        <p className="text-center text-xs text-gray-400 mb-6">USD prices are for reference — all workspaces are billed in KES via Paystack.</p>
      )}

      <PlanComparison
        plans={plans}
        currency={currency}
        interval={interval}
        mostPopularTier="pro"
        onSelect={() => router.push('/signup')}
        selectLabel={() => 'Start free, upgrade anytime'}
      />

      <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-8">
        Every plan starts with a 14-day free trial with full Professional-level access — no card required.
      </p>
    </div>
  );
}
