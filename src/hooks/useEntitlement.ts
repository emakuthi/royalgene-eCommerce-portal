'use client';

import { useEffect, useState, useCallback } from 'react';
import { useHydratedAuth } from '@/lib/hooks';
import { getBillingFeatures, getBillingUsage, type FeaturesSnapshot, type UsageSnapshot } from '@/lib/billing';
import type { FeatureCodeValue, LimitCodeValue } from '@/lib/entitlements/feature-codes';

export interface EntitlementState {
  loading: boolean;
  features: FeaturesSnapshot['features'];
  limits: UsageSnapshot['limits'];
  plan: UsageSnapshot['plan'];
  subscriptionStatus: string | null;
  hasFeature: (code: FeatureCodeValue) => boolean;
  getLimit: (code: LimitCodeValue) => { limit: number | null; usage: number; remaining: number | null } | undefined;
  refresh: () => void;
}

/** Loads the caller's feature/usage snapshot once per session — every FeatureGate/UsageMeter on the page shares this one fetch. */
export function useEntitlement(): EntitlementState {
  const { token, user } = useHydratedAuth();
  // super_admin has no organizationId — the backend entitlement routes 400
  // on that (there's nothing to check a plan against) and every backend
  // feature check in the API routes already skips itself for this case.
  // The frontend gate must bypass the same way, or a platform admin would
  // get locked out of pages the backend would actually let them use.
  const isPlatformStaff = user?.role === 'super_admin' || !user?.organizationId;
  const [loading, setLoading] = useState(!isPlatformStaff);
  const [features, setFeatures] = useState<FeaturesSnapshot['features']>({});
  const [limits, setLimits] = useState<UsageSnapshot['limits']>({});
  const [plan, setPlan] = useState<UsageSnapshot['plan']>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!token || isPlatformStaff) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([getBillingFeatures(token), getBillingUsage(token)]).then(([featuresRes, usageRes]) => {
      if (cancelled) return;
      if (featuresRes.success && featuresRes.data) {
        setFeatures(featuresRes.data.features);
        setPlan(featuresRes.data.plan);
      }
      if (usageRes.success && usageRes.data) {
        setLimits(usageRes.data.limits);
        setSubscriptionStatus(usageRes.data.subscription.status);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token, nonce, isPlatformStaff]);

  const hasFeature = useCallback((code: FeatureCodeValue) => isPlatformStaff || Boolean(features[code]), [features, isPlatformStaff]);
  const getLimit = useCallback((code: LimitCodeValue) => limits[code], [limits]);

  return { loading, features, limits, plan, subscriptionStatus, hasFeature, getLimit, refresh };
}
