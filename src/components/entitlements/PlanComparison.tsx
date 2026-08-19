'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { PublicPlan } from '@/lib/billing';
import { FEATURE_LABELS, PLAN_CARD_FEATURE_ORDER } from './feature-labels';

export interface PlanComparisonProps {
  plans: PublicPlan[];
  currency: 'KES' | 'USD';
  interval: 'monthly' | 'annually';
  currentPlanTier?: string | null;
  busyPlanId?: string | null;
  onSelect?: (plan: PublicPlan) => void;
  selectLabel?: (plan: PublicPlan, isCurrent: boolean) => string;
  mostPopularTier?: string;
}

function formatPrice(plan: PublicPlan, currency: 'KES' | 'USD', interval: 'monthly' | 'annually'): string {
  if (currency === 'USD') {
    const cents = interval === 'annually' ? plan.annualPriceUSD : plan.monthlyPriceUSD;
    if (cents === null || cents === undefined) return 'Custom';
    return `$${(cents / 100).toLocaleString('en-US')}`;
  }
  const kobo = interval === 'annually' ? plan.annualPriceKobo : plan.monthlyPriceKobo;
  return `KES ${(kobo / 100).toLocaleString('en-KE')}`;
}

export function PlanComparison({
  plans,
  currency,
  interval,
  currentPlanTier,
  busyPlanId,
  onSelect,
  selectLabel,
  mostPopularTier = 'pro',
}: PlanComparisonProps) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {plans.map((plan) => {
        const isCurrent = currentPlanTier === plan.tier;
        const isMostPopular = plan.tier === mostPopularTier;
        const enabledCodes = new Set(plan.entitlements.filter((e) => e.enabled).map((e) => e.code));
        const checklist = PLAN_CARD_FEATURE_ORDER.filter((code) => enabledCodes.has(code));

        return (
          <div
            key={plan.id}
            className={`relative rounded-xl border p-5 flex flex-col gap-4 ${
              isMostPopular ? 'border-[hsl(var(--primary))] ring-1 ring-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'
            }`}
          >
            {isMostPopular && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs px-2 py-0.5 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]">
                Most Popular
              </Badge>
            )}
            <div>
              <p className="font-semibold text-gray-900 dark:text-white">{plan.name}</p>
              {plan.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{plan.description}</p>}
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatPrice(plan, currency, interval)}
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                  {formatPrice(plan, currency, interval) !== 'Custom' ? `/${interval === 'annually' ? 'yr' : 'mo'}` : ''}
                </span>
              </p>
              {currency === 'USD' && <p className="text-xs text-gray-400 mt-0.5">Reference price — billed in KES</p>}
            </div>
            <ul className="space-y-1.5 text-sm text-gray-600 dark:text-gray-300 flex-1">
              {checklist.map((code) => (
                <li key={code} className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  {FEATURE_LABELS[code]}
                </li>
              ))}
            </ul>
            {onSelect && (
              <Button className="mt-auto" disabled={isCurrent || busyPlanId === plan.id} onClick={() => onSelect(plan)}>
                {selectLabel ? selectLabel(plan, isCurrent) : isCurrent ? 'Current Plan' : busyPlanId === plan.id ? 'Redirecting…' : 'Choose Plan'}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
