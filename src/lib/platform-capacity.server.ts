import 'server-only';
import { supabaseAdmin } from './supabase-client';

/**
 * Cross-tenant aggregate usage — application-level metrics only. Deliberately
 * does NOT include Supabase infrastructure metrics (DB disk %, connection
 * pool usage, etc.) — those require the Supabase Management API, which this
 * app has no credentials for. Fabricating them would violate the whole point
 * of a capacity dashboard, so they're omitted rather than guessed.
 */
export interface PlatformCapacity {
  totalTenants: number;
  totalUsers: number;
  totalShops: number;
  totalProducts: number;
  monthlyTransactions: number;
  totalStorageBytes: number;
  /** Tenants that crossed a usage threshold in the current calendar-month period, most severe first. */
  tenantsNearingLimit: Array<{
    organizationId: string;
    organizationName: string;
    limitCode: string;
    threshold: number;
    notifiedAt: string;
  }>;
}

function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function currentPeriodKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getPlatformCapacity(): Promise<PlatformCapacity> {
  const [
    { count: totalTenants },
    { count: totalUsers },
    { count: totalShops },
    { count: totalProducts },
    { count: monthlyTransactions },
    storageRows,
    thresholdRows,
  ] = await Promise.all([
    supabaseAdmin.from('Organization').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('User').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('Shop').select('*', { count: 'exact', head: true }),
    supabaseAdmin.from('Product').select('*', { count: 'exact', head: true }),
    supabaseAdmin
      .from('SalesEntry')
      .select('*', { count: 'exact', head: true })
      .gte('createdAt', startOfCurrentMonthIso()),
    supabaseAdmin.from('TenantFileUpload').select('sizeBytes').is('deletedAt', null),
    supabaseAdmin
      .from('UsageThresholdNotification')
      .select('organizationId, limitCode, threshold, notifiedAt')
      .eq('period', currentPeriodKey())
      .order('threshold', { ascending: false })
      .order('notifiedAt', { ascending: false })
      .limit(20),
  ]);

  const totalStorageBytes = (storageRows.data ?? []).reduce(
    (sum, row) => sum + Number((row as { sizeBytes: number }).sizeBytes ?? 0),
    0,
  );

  const rows = (thresholdRows.data ?? []) as Array<{
    organizationId: string;
    limitCode: string;
    threshold: number;
    notifiedAt: string;
  }>;
  const orgIds = [...new Set(rows.map((r) => r.organizationId))];
  const orgNameMap = new Map<string, string>();
  if (orgIds.length > 0) {
    const { data: orgs } = await supabaseAdmin.from('Organization').select('id, name').in('id', orgIds);
    for (const o of (orgs ?? []) as { id: string; name: string }[]) {
      orgNameMap.set(o.id, o.name);
    }
  }

  return {
    totalTenants: totalTenants ?? 0,
    totalUsers: totalUsers ?? 0,
    totalShops: totalShops ?? 0,
    totalProducts: totalProducts ?? 0,
    monthlyTransactions: monthlyTransactions ?? 0,
    totalStorageBytes,
    tenantsNearingLimit: rows.map((r) => ({
      organizationId: r.organizationId,
      organizationName: orgNameMap.get(r.organizationId) ?? 'Unknown',
      limitCode: r.limitCode,
      threshold: r.threshold,
      notifiedAt: r.notifiedAt,
    })),
  };
}
