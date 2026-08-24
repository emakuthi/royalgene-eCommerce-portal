import 'server-only';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../supabase-client';
import logger from '../logger';
import type { LimitCodeValue } from './feature-codes';

const THRESHOLDS = [70, 80, 90, 95, 100] as const;

const LIMIT_LABELS: Record<LimitCodeValue, string> = {
  USERS: 'team members',
  BRANCHES: 'branches/shops',
  WAREHOUSES: 'warehouses',
  PRODUCTS: 'products',
  MONTHLY_TRANSACTIONS: 'monthly transactions',
  STORAGE_GB: 'storage',
};

function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Call right after determining a create/upload IS allowed, with the usage
 * value it will have once that operation completes (not the pre-operation
 * usage assertCanCreate/assertStorageQuota compute their allow/deny
 * decision from). Fire-and-forget from the caller — never blocks or fails
 * the underlying operation.
 *
 * Only the single highest threshold crossed is notified per call, to avoid
 * firing 70/80/90/95 all at once if usage jumps in one step (e.g. a large
 * storage upload) — matches the "avoid excessive notifications" goal.
 * Deduped per (org, limit, threshold, calendar-month) via a unique
 * constraint, so this is safe to call on every allowed operation.
 */
export async function checkUsageThresholds(
  organizationId: string,
  limitCode: LimitCodeValue,
  projectedUsage: number,
  limit: number | null,
): Promise<void> {
  try {
    if (limit === null || limit <= 0) return; // unlimited, or no plan — nothing meaningful to warn about
    const pct = (projectedUsage / limit) * 100;

    const crossed = THRESHOLDS.filter((t) => pct >= t);
    if (crossed.length === 0) return;
    const threshold = crossed[crossed.length - 1];

    const period = currentPeriodKey();
    const { error: insertError } = await supabaseAdmin
      .from('UsageThresholdNotification')
      .insert([{ organizationId, limitCode, threshold, period }]);

    if (insertError) {
      // Unique-constraint hit (already notified this period) or a real DB
      // error — either way, don't create a duplicate/unrecorded Alert.
      return;
    }

    const label = LIMIT_LABELS[limitCode] ?? limitCode;
    const message =
      threshold >= 100
        ? `You've reached your plan's limit for ${label}.`
        : `You've used ${threshold}% of your plan's ${label} limit.`;

    const { error: alertError } = await supabaseAdmin.from('Alert').insert([
      {
        id: uuidv4(),
        organizationId,
        title: threshold >= 100 ? 'Plan limit reached' : 'Approaching plan limit',
        message,
        level: threshold >= 100 ? 'critical' : threshold >= 90 ? 'warning' : 'info',
        read: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    if (alertError) {
      logger.error('[usage-notifications] failed to create alert', { error: alertError.message, organizationId, limitCode, threshold });
    }
  } catch (err) {
    logger.error('[usage-notifications] unexpected error', { error: err instanceof Error ? err.message : String(err) });
  }
}
