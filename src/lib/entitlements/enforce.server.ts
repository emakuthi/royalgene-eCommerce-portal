import 'server-only';
import { NextResponse } from 'next/server';
import { jsonResponse } from '../apiResponse';
import { getStorageUsageBytes } from '../storage-usage.server';
import { canCreate, getActiveSubscription, getLimit, hasFeature } from './entitlement-service.server';
import { LimitCode, type FeatureCodeValue, type ResourceTypeValue } from './feature-codes';
import { checkUsageThresholds } from './usage-notifications.server';

/**
 * Call right after resolving the caller's organizationId and before the
 * insert. Returns `null` when the resource may be created; otherwise a
 * ready-to-return NextResponse in the shape the frontend's UpgradeDialog
 * expects. Never trusts anything from the request body — organizationId
 * must already have been resolved from the authenticated session.
 */
const RESOURCE_NOUNS: Record<ResourceTypeValue, [string, string]> = {
  BRANCH: ['shop', 'shops'],
  USER: ['team member', 'team members'],
  PRODUCT: ['product', 'products'],
  TRANSACTION: ['sale a month', 'sales a month'],
};

/** e.g. "Your Starter plan includes 2 shops. Upgrade your plan to add more." */
export function limitReachedMessage(resource: ResourceTypeValue, limit: number | null, planName: string | null): string {
  const [one, many] = RESOURCE_NOUNS[resource] ?? ['item', 'items'];
  if (!limit) return `Your workspace doesn't have an active plan. Subscribe to add ${many}.`;
  const plan = planName ? `Your ${planName} plan` : 'Your plan';
  return `${plan} includes ${limit} ${limit === 1 ? one : many}. Upgrade your plan to add more.`;
}

export async function assertCanCreate(organizationId: string, resource: ResourceTypeValue): Promise<NextResponse | null> {
  const result = await canCreate(organizationId, resource);
  if (result.allowed) {
    // Fire-and-forget: usage after this create succeeds = currentUsage + 1
    // (each of these resources is created one row at a time).
    void checkUsageThresholds(organizationId, result.feature, result.currentUsage + 1, result.limit);
    return null;
  }

  // Over the hard limit — let it through if the plan allows overage. The
  // excess is billed via generateInvoice() at period-close, not blocked
  // here at the point of use.
  const ctx = await getActiveSubscription(organizationId);
  if (ctx?.plan?.allowOverage) {
    void checkUsageThresholds(organizationId, result.feature, result.currentUsage + 1, result.limit);
    return null;
  }

  const message = limitReachedMessage(resource, result.limit, ctx?.plan?.name ?? null);
  return jsonResponse(
    {
      success: false,
      error: message,
      code: 'PLAN_LIMIT_REACHED',
      message,
      feature: result.feature,
      limit: result.limit,
      currentUsage: result.currentUsage,
      upgradeRequired: true,
    },
    403,
  ) as unknown as NextResponse;
}

/**
 * Call right before a Supabase Storage upload, with the incoming file's byte
 * size. Unlike assertCanCreate this isn't a row-count resource, so it isn't
 * routed through ResourceType/canCreate — it compares live SUM(sizeBytes)
 * (from TenantFileUpload) against the plan's STORAGE_GB limit directly.
 */
export async function assertStorageQuota(organizationId: string, additionalBytes: number): Promise<NextResponse | null> {
  // getLimit already resolves legacy-unlimited -> null and restricted/no-plan -> 0.
  const limitGB = await getLimit(organizationId, LimitCode.STORAGE_GB);
  if (limitGB === null) return null;

  const limitBytes = limitGB * 1024 ** 3;
  const usageBytes = await getStorageUsageBytes(organizationId);

  if (usageBytes + additionalBytes <= limitBytes) {
    const projectedUsageGB = (usageBytes + additionalBytes) / 1024 ** 3;
    void checkUsageThresholds(organizationId, LimitCode.STORAGE_GB, projectedUsageGB, limitGB);
    return null;
  }

  const ctx = await getActiveSubscription(organizationId);
  if (ctx?.plan?.allowOverage) {
    const projectedUsageGB = (usageBytes + additionalBytes) / 1024 ** 3;
    void checkUsageThresholds(organizationId, LimitCode.STORAGE_GB, projectedUsageGB, limitGB);
    return null;
  }

  const currentUsageGB = Math.round((usageBytes / 1024 ** 3) * 100) / 100;
  return jsonResponse(
    {
      success: false,
      error: `You've reached your plan's storage limit.`,
      code: 'PLAN_LIMIT_REACHED',
      message: `You've reached your plan's storage limit.`,
      feature: LimitCode.STORAGE_GB,
      limit: limitGB,
      currentUsage: currentUsageGB,
      upgradeRequired: true,
    },
    403,
  ) as unknown as NextResponse;
}

export async function assertFeatureEnabled(organizationId: string, feature: FeatureCodeValue): Promise<NextResponse | null> {
  const [enabled, ctx] = await Promise.all([hasFeature(organizationId, feature), getActiveSubscription(organizationId)]);
  if (enabled) return null;

  return jsonResponse(
    {
      success: false,
      error: `This feature is not available on your current plan.`,
      code: 'FEATURE_NOT_AVAILABLE',
      message: `This feature is not available on your current plan.`,
      feature,
      currentPlan: ctx?.plan?.code ?? ctx?.organization.planTier ?? null,
      upgradeRequired: true,
    },
    403,
  ) as unknown as NextResponse;
}
