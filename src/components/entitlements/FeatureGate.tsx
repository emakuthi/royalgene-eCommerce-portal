'use client';

import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { useEntitlement } from '@/hooks/useEntitlement';
import type { FeatureCodeValue } from '@/lib/entitlements/feature-codes';

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  business: 'Business',
  pro: 'Professional',
  enterprise: 'Enterprise',
};

export function FeatureGate({
  feature,
  children,
  mode = 'lock',
  requiredPlanLabel,
  onUpgradeClick,
}: {
  feature: FeatureCodeValue;
  children: ReactNode;
  /** 'lock' shows a locked-state placeholder (discoverable); 'hide' renders nothing — use for destructive/sensitive actions. */
  mode?: 'lock' | 'hide';
  /** Optional override for the "Available on X" copy — otherwise just says "a higher plan". */
  requiredPlanLabel?: string;
  onUpgradeClick?: () => void;
}) {
  const { loading, hasFeature, plan } = useEntitlement();

  if (loading) return null;
  if (hasFeature(feature)) return <>{children}</>;
  if (mode === 'hide') return null;

  const currentPlanLabel = plan ? PLAN_LABELS[plan.tier] || plan.name : null;

  return (
    <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-gray-50 dark:bg-gray-900/50 p-4 flex items-center gap-3">
      <Lock className="h-5 w-5 text-gray-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {requiredPlanLabel ? `Available on ${requiredPlanLabel}` : 'Available on a higher plan'}
        </p>
        {currentPlanLabel && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">You&apos;re currently on {currentPlanLabel}.</p>}
      </div>
      <button
        type="button"
        onClick={onUpgradeClick}
        className="text-xs font-medium text-[hsl(var(--primary))] hover:underline shrink-0"
      >
        Upgrade
      </button>
    </div>
  );
}
