'use client';

import { useEntitlement } from '@/hooks/useEntitlement';
import { LimitCode, type LimitCodeValue } from '@/lib/entitlements/feature-codes';
import { UsageMeter } from './UsageMeter';

const LIMIT_LABELS: Partial<Record<LimitCodeValue, string>> = {
  [LimitCode.USERS]: 'Team members',
  [LimitCode.BRANCHES]: 'Branches / shops',
  [LimitCode.PRODUCTS]: 'Products',
  [LimitCode.MONTHLY_TRANSACTIONS]: 'Sales this month',
};

/** Every wired UsageMeter for the caller's own org, in one composite — used by the Settings Billing tab. */
export function UsageSummary() {
  const { loading, limits } = useEntitlement();

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400">Loading usage…</p>;

  const codes = (Object.keys(LIMIT_LABELS) as LimitCodeValue[]).filter((code) => limits[code]);

  if (codes.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No usage data available yet.</p>;
  }

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {codes.map((code) => {
        const entry = limits[code]!;
        return <UsageMeter key={code} label={LIMIT_LABELS[code]!} usage={entry.usage} limit={entry.limit} />;
      })}
    </div>
  );
}
