import 'server-only';
import { NextResponse } from 'next/server';
import { jsonResponse } from '../apiResponse';
import { canCreate, getActiveSubscription, hasFeature } from './entitlement-service.server';
import type { FeatureCodeValue, ResourceTypeValue } from './feature-codes';

/**
 * Call right after resolving the caller's organizationId and before the
 * insert. Returns `null` when the resource may be created; otherwise a
 * ready-to-return NextResponse in the shape the frontend's UpgradeDialog
 * expects. Never trusts anything from the request body — organizationId
 * must already have been resolved from the authenticated session.
 */
export async function assertCanCreate(organizationId: string, resource: ResourceTypeValue): Promise<NextResponse | null> {
  const result = await canCreate(organizationId, resource);
  if (result.allowed) return null;

  return jsonResponse(
    {
      success: false,
      error: `You've reached your plan's limit for this resource.`,
      code: 'PLAN_LIMIT_REACHED',
      message: `You've reached your plan's limit for this resource.`,
      feature: result.feature,
      limit: result.limit,
      currentUsage: result.currentUsage,
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
