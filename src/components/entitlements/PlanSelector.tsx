'use client';

import { Button } from '@/components/ui/button';
import type { PublicPlan } from '@/lib/billing';

/** Compact single-column plan picker — used inside dialogs/onboarding flows where the full PlanComparison grid is too heavy. */
export function PlanSelector({
  plans,
  currentPlanTier,
  busyPlanId,
  onSelect,
}: {
  plans: PublicPlan[];
  currentPlanTier?: string | null;
  busyPlanId?: string | null;
  onSelect: (plan: PublicPlan) => void;
}) {
  return (
    <div className="space-y-2">
      {plans.map((plan) => {
        const isCurrent = currentPlanTier === plan.tier;
        return (
          <button
            key={plan.id}
            type="button"
            disabled={isCurrent || busyPlanId === plan.id}
            onClick={() => onSelect(plan)}
            className="w-full flex items-center justify-between rounded-lg border border-[hsl(var(--border))] px-4 py-3 text-left hover:border-[hsl(var(--primary))] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">{plan.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">KES {(plan.monthlyPriceKobo / 100).toLocaleString('en-KE')}/mo</p>
            </div>
            <Button size="sm" variant={isCurrent ? 'outline' : 'default'} tabIndex={-1}>
              {isCurrent ? 'Current' : busyPlanId === plan.id ? '…' : 'Select'}
            </Button>
          </button>
        );
      })}
    </div>
  );
}
