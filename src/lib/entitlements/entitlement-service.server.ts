import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import { getStorageUsageGB } from '../storage-usage.server';
import type { Organization, PlatformPlan, TenantSubscription } from '../types';
import {
  FeatureCode,
  type FeatureCodeValue,
  LimitCode,
  type LimitCodeValue,
  RESOURCE_TO_LIMIT_CODE,
  type ResourceTypeValue,
  WIRED_FEATURE_CODES,
  WIRED_LIMIT_CODES,
} from './feature-codes';

/** Subscription states that should stop new premium usage while preserving existing data. */
const RESTRICTED_STATUSES = new Set(['expired', 'suspended', 'cancelled']);

export interface EntitlementContext {
  organization: Organization;
  subscription: TenantSubscription | null;
  plan: PlatformPlan | null;
  /** `legacy` tenants (grandfathered pre-billing orgs) bypass every check. */
  isLegacyUnlimited: boolean;
  /** True when the subscription is expired/suspended/cancelled — blocks new premium usage, never blocks reads. */
  isRestricted: boolean;
}

export async function getActiveSubscription(organizationId: string): Promise<EntitlementContext | null> {
  const { data: organization } = await supabaseAdmin
    .from('Organization')
    .select('*')
    .eq('id', organizationId)
    .maybeSingle();

  if (!organization) return null;
  const org = organization as Organization;

  const isLegacyUnlimited = org.planTier === 'legacy';

  const { data: subscriptionRow } = await supabaseAdmin
    .from('TenantSubscription')
    .select('*')
    .eq('organizationId', organizationId)
    .maybeSingle();
  const subscription = (subscriptionRow as TenantSubscription | null) ?? null;

  let plan: PlatformPlan | null = null;
  if (subscription?.planId) {
    const { data: planRow } = await supabaseAdmin
      .from('PlatformPlan')
      .select('*')
      .eq('id', subscription.planId)
      .maybeSingle();
    plan = (planRow as PlatformPlan | null) ?? null;
  }

  // A trial past its end date is functionally expired even before anything
  // writes that back to the DB — subscription-status.server.ts's expireTrial
  // reconciles the row itself, but reads must never rely on that cron-less
  // write having happened yet.
  const trialLapsed = Boolean(
    subscription && subscription.status === 'trialing' && subscription.trialEnd && new Date(subscription.trialEnd).getTime() < Date.now(),
  );
  const effectiveStatus = trialLapsed ? 'expired' : subscription?.status;
  const isRestricted = !isLegacyUnlimited && Boolean(subscription && effectiveStatus && RESTRICTED_STATUSES.has(effectiveStatus));

  return {
    organization: org,
    subscription: subscription && trialLapsed ? { ...subscription, status: 'expired' } : subscription,
    plan,
    isLegacyUnlimited,
    isRestricted,
  };
}

export async function hasFeature(organizationId: string, feature: FeatureCodeValue): Promise<boolean> {
  const ctx = await getActiveSubscription(organizationId);
  if (!ctx) return false;
  if (ctx.isLegacyUnlimited) return true;
  if (ctx.isRestricted || !ctx.plan) return false;

  const { data } = await supabaseAdmin
    .from('PlanEntitlement')
    .select('enabled')
    .eq('planId', ctx.plan.id)
    .eq('code', feature)
    .maybeSingle();

  return Boolean(data?.enabled);
}

/** Returns the plan's configured limit for a code — `null` means unlimited. Restricted/no-plan orgs get 0 (blocks new creation, never blocks reads). */
export async function getLimit(organizationId: string, limitCode: LimitCodeValue): Promise<number | null> {
  const ctx = await getActiveSubscription(organizationId);
  if (!ctx) return 0;
  if (ctx.isLegacyUnlimited) return null;
  if (ctx.isRestricted || !ctx.plan) return 0;

  const { data } = await supabaseAdmin
    .from('PlanEntitlement')
    .select('limitValue')
    .eq('planId', ctx.plan.id)
    .eq('code', limitCode)
    .maybeSingle();

  if (!data) return 0;
  return data.limitValue === null || data.limitValue === undefined ? null : Number(data.limitValue);
}

function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Real-time COUNT against the underlying table — no cached counters yet, app scale doesn't warrant them. */
export async function getUsage(organizationId: string, resource: ResourceTypeValue): Promise<number> {
  switch (resource) {
    case 'USER': {
      const { count } = await supabaseAdmin
        .from('PortalUser')
        .select('*', { count: 'exact', head: true })
        .eq('organizationId', organizationId);
      return count ?? 0;
    }
    case 'BRANCH': {
      const { count } = await supabaseAdmin
        .from('Shop')
        .select('*', { count: 'exact', head: true })
        .eq('organizationId', organizationId);
      return count ?? 0;
    }
    case 'PRODUCT': {
      const { count } = await supabaseAdmin
        .from('Product')
        .select('*', { count: 'exact', head: true })
        .eq('organizationId', organizationId);
      return count ?? 0;
    }
    case 'TRANSACTION': {
      const { count } = await supabaseAdmin
        .from('SalesEntry')
        .select('*', { count: 'exact', head: true })
        .eq('organizationId', organizationId)
        .gte('createdAt', startOfCurrentMonthIso());
      return count ?? 0;
    }
    default:
      return 0;
  }
}

export interface CanCreateResult {
  allowed: boolean;
  feature: LimitCodeValue;
  limit: number | null;
  currentUsage: number;
  remaining: number | null;
}

export async function canCreate(organizationId: string, resource: ResourceTypeValue): Promise<CanCreateResult> {
  const limitCode = RESOURCE_TO_LIMIT_CODE[resource];
  const [limit, currentUsage] = await Promise.all([getLimit(organizationId, limitCode), getUsage(organizationId, resource)]);

  if (limit === null) {
    return { allowed: true, feature: limitCode, limit: null, currentUsage, remaining: null };
  }

  const remaining = Math.max(limit - currentUsage, 0);
  return { allowed: currentUsage < limit, feature: limitCode, limit, currentUsage, remaining };
}

export interface TenantEntitlementSummary {
  plan: { id: string; code: string | null; name: string; tier: string } | null;
  subscription: {
    status: TenantSubscription['status'] | 'legacy';
    trialEnd: string | null;
    currentPeriodEnd: string | null;
  };
  features: Partial<Record<FeatureCodeValue, boolean>>;
  limits: Partial<Record<LimitCodeValue, { limit: number | null; usage: number; remaining: number | null }>>;
}

const LIMIT_CODE_TO_RESOURCE: Partial<Record<LimitCodeValue, ResourceTypeValue>> = {
  [LimitCode.USERS]: 'USER',
  [LimitCode.BRANCHES]: 'BRANCH',
  [LimitCode.PRODUCTS]: 'PRODUCT',
  [LimitCode.MONTHLY_TRANSACTIONS]: 'TRANSACTION',
};

/** One-call snapshot for the frontend — avoids the UI making a dozen round trips for each feature/limit it wants to show. */
export async function getTenantEntitlementSummary(organizationId: string): Promise<TenantEntitlementSummary> {
  const ctx = await getActiveSubscription(organizationId);

  if (!ctx) {
    return {
      plan: null,
      subscription: { status: 'expired', trialEnd: null, currentPeriodEnd: null },
      features: {},
      limits: {},
    };
  }

  const features: Partial<Record<FeatureCodeValue, boolean>> = {};
  await Promise.all(
    WIRED_FEATURE_CODES.map(async (code) => {
      features[code] = ctx.isLegacyUnlimited ? true : await hasFeature(organizationId, code);
    }),
  );

  const limits: Partial<Record<LimitCodeValue, { limit: number | null; usage: number; remaining: number | null }>> = {};
  await Promise.all(
    WIRED_LIMIT_CODES.map(async (code) => {
      if (code === LimitCode.STORAGE_GB) {
        // Bytes-based, not a row-count resource — doesn't fit the
        // ResourceType/canCreate model the other limits use.
        const limitGB = ctx.isLegacyUnlimited ? null : await getLimit(organizationId, LimitCode.STORAGE_GB);
        const usageGB = await getStorageUsageGB(organizationId);
        const remaining = limitGB === null ? null : Math.max(Math.round((limitGB - usageGB) * 100) / 100, 0);
        limits[code] = { limit: limitGB, usage: usageGB, remaining };
        return;
      }
      const resource = LIMIT_CODE_TO_RESOURCE[code];
      if (!resource) return;
      const result = await canCreate(organizationId, resource);
      limits[code] = { limit: result.limit, usage: result.currentUsage, remaining: result.remaining };
    }),
  );

  return {
    plan: ctx.plan ? { id: ctx.plan.id, code: ctx.plan.code ?? null, name: ctx.plan.name, tier: ctx.plan.tier } : null,
    subscription: {
      status: ctx.isLegacyUnlimited ? 'legacy' : (ctx.subscription?.status ?? 'expired'),
      trialEnd: ctx.subscription?.trialEnd ?? null,
      currentPeriodEnd: ctx.subscription?.currentPeriodEnd ?? null,
    },
    features,
    limits,
  };
}

export { FeatureCode, LimitCode };
