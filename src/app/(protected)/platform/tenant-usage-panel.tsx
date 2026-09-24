'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UsageGauge } from '@/components/entitlements/UsageGauge';
import {
  getOrgEntitlementOverrides,
  updateOrgEntitlementOverrides,
  resetOrgEntitlementOverride,
  type EffectiveLimit,
  type OrgEntitlementOverrideRow,
} from '@/lib/platform';
import { LimitCode, type LimitCodeValue } from '@/lib/entitlements/feature-codes';

const LIMIT_LABELS: Partial<Record<LimitCodeValue, string>> = {
  [LimitCode.STORAGE_GB]: 'Storage',
  [LimitCode.PRODUCTS]: 'Products',
  [LimitCode.USERS]: 'Team members',
  [LimitCode.BRANCHES]: 'Branches / shops',
  [LimitCode.MONTHLY_TRANSACTIONS]: 'Sales this month',
};

const LIMIT_UNITS: Partial<Record<LimitCodeValue, string>> = {
  [LimitCode.STORAGE_GB]: 'GB',
};

/** These three ship an override editor; the rest render read-only for context. */
const OVERRIDABLE_CODES: LimitCodeValue[] = [LimitCode.STORAGE_GB, LimitCode.PRODUCTS, LimitCode.USERS];
const READONLY_CODES: LimitCodeValue[] = [LimitCode.BRANCHES, LimitCode.MONTHLY_TRANSACTIONS];

/**
 * Super-admin per-tenant usage + quota-override panel: shows this org's live
 * usage against its effective limit for each metric, and lets a super-admin
 * override STORAGE_GB/PRODUCTS/USERS independent of the tenant's plan
 * (negotiated deals, temporary bumps) — or reset back to the plan default.
 */
export function TenantUsagePanel({ token, orgId }: { token: string | null | undefined; orgId: string }) {
  const [effective, setEffective] = useState<Partial<Record<LimitCodeValue, EffectiveLimit>>>({});
  const [overrides, setOverrides] = useState<OrgEntitlementOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<LimitCodeValue, string>>>({});
  const [busyCode, setBusyCode] = useState<LimitCodeValue | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getOrgEntitlementOverrides(token, orgId);
    if (res.ok && res.success && res.data) {
      setEffective(res.data.effective as Partial<Record<LimitCodeValue, EffectiveLimit>>);
      setOverrides(res.data.overrides);
    } else {
      setError(res.error || 'Could not load usage');
    }
    setLoading(false);
  }, [token, orgId]);

  useEffect(() => { void load(); }, [load]);

  const overrideFor = (code: LimitCodeValue) => overrides.find((o) => o.code === code);

  const saveOverride = async (code: LimitCodeValue) => {
    const draft = drafts[code];
    if (draft === undefined || draft.trim() === '') return;
    const limitValue = draft.trim().toLowerCase() === 'unlimited' ? null : Number(draft);
    if (limitValue !== null && (!Number.isFinite(limitValue) || limitValue < 0)) {
      toast.error('Enter a non-negative number, or "unlimited"');
      return;
    }
    setBusyCode(code);
    const res = await updateOrgEntitlementOverrides(token, orgId, [{ code, limitValue }]);
    setBusyCode(null);
    if (res.ok && res.success) {
      toast.success(`${LIMIT_LABELS[code]} quota overridden for this tenant`);
      setDrafts((prev) => ({ ...prev, [code]: undefined }));
      void load();
    } else {
      toast.error(res.error || 'Failed to save override');
    }
  };

  const resetOverride = async (code: LimitCodeValue) => {
    setBusyCode(code);
    const res = await resetOrgEntitlementOverride(token, orgId, code);
    setBusyCode(null);
    if (res.ok && res.success) {
      toast.success(`${LIMIT_LABELS[code]} reverted to the plan default`);
      void load();
    } else {
      toast.error(res.error || 'Failed to reset override');
    }
  };

  if (loading) return <p className="text-sm text-gray-500 dark:text-gray-400">Loading usage…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[...OVERRIDABLE_CODES, ...READONLY_CODES].map((code) => {
          const entry = effective[code];
          if (!entry) return null;
          return (
            <UsageGauge
              key={code}
              label={LIMIT_LABELS[code]!}
              usage={entry.usage}
              limit={entry.limit}
              unit={LIMIT_UNITS[code]}
              isOverridden={entry.isOverridden}
            />
          );
        })}
      </div>

      <div className="space-y-3">
        {OVERRIDABLE_CODES.map((code) => {
          const existing = overrideFor(code);
          const entry = effective[code];
          return (
            <div key={code} className="flex items-center gap-2 rounded-md border border-gray-200 dark:border-gray-800 p-2">
              <span className="text-sm text-gray-600 dark:text-gray-300 w-32 shrink-0">{LIMIT_LABELS[code]}</span>
              <Input
                placeholder={existing ? String(existing.limitValue ?? 'unlimited') : `Plan default${entry?.limit != null ? `: ${entry.limit}` : ''}`}
                value={drafts[code] ?? ''}
                onChange={(e) => setDrafts((prev) => ({ ...prev, [code]: e.target.value }))}
                disabled={busyCode === code}
                className="flex-1 h-8 text-sm"
              />
              <Button size="sm" disabled={busyCode === code || !drafts[code]?.trim()} onClick={() => saveOverride(code)}>
                Save override
              </Button>
              {existing && (
                <Button size="sm" variant="outline" disabled={busyCode === code} onClick={() => resetOverride(code)}>
                  Reset to plan
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
