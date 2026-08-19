import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/authorize';
import { jsonResponse, optionsResponse } from '@/lib/apiResponse';
import { getActiveSubscription } from '@/lib/entitlements/entitlement-service.server';
import {
  assignPlan,
  extendTrial,
  reactivateSubscription,
  suspendSubscription,
} from '@/lib/entitlements/subscription-status.server';

// GET /api/platform/organizations/[id]/subscription — full subscription context for one org, super_admin only.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const ctx = await getActiveSubscription(id);
  if (!ctx) return jsonResponse({ success: false, error: 'Organization not found' }, 404);
  return jsonResponse({ success: true, data: ctx });
}

// POST /api/platform/organizations/[id]/subscription — full subscription lifecycle control, super_admin only.
// { action: 'assignPlan', planId, status?, billingInterval? }
// { action: 'extendTrial', extraDays }
// { action: 'suspend' } | { action: 'reactivate' }
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireRole(request, ['super_admin']);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const body = await request.json();
  const action = body?.action as string | undefined;

  try {
    switch (action) {
      case 'assignPlan': {
        if (!body.planId) return jsonResponse({ success: false, error: 'planId is required' }, 400);
        const subscription = await assignPlan({
          organizationId: id,
          planId: body.planId,
          status: body.status,
          billingInterval: body.billingInterval ?? null,
          actorUserId: auth.userId,
        });
        return jsonResponse({ success: true, data: subscription });
      }
      case 'extendTrial': {
        const extraDays = Number(body.extraDays);
        if (!Number.isFinite(extraDays) || extraDays <= 0) {
          return jsonResponse({ success: false, error: 'extraDays must be a positive number' }, 400);
        }
        const subscription = await extendTrial(id, extraDays, auth.userId);
        return jsonResponse({ success: true, data: subscription });
      }
      case 'suspend': {
        const subscription = await suspendSubscription(id, auth.userId);
        return jsonResponse({ success: true, data: subscription });
      }
      case 'reactivate': {
        const subscription = await reactivateSubscription(id, auth.userId);
        return jsonResponse({ success: true, data: subscription });
      }
      default:
        return jsonResponse({ success: false, error: 'Unknown action. Use assignPlan | extendTrial | suspend | reactivate.' }, 400);
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Failed to update subscription' }, 500);
  }
}

export function OPTIONS() {
  return optionsResponse('GET,POST,OPTIONS');
}
