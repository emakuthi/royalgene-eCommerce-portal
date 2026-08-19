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
  const { token } = useHydratedAuth();
  const [loading, setLoading] = useState(true);
  const [features, setFeatures] = useState<FeaturesSnapshot['features']>({});
  const [limits, setLimits] = useState<UsageSnapshot['limits']>({});
  const [plan, setPlan] = useState<UsageSnapshot['plan']>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!token) {
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
  }, [token, nonce]);

  const hasFeature = useCallback((code: FeatureCodeValue) => Boolean(features[code]), [features]);
  const getLimit = useCallback((code: LimitCodeValue) => limits[code], [limits]);

  return { loading, features, limits, plan, subscriptionStatus, hasFeature, getLimit, refresh };
}
