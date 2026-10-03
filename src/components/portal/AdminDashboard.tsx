'use client';

import Link from 'next/link';
import StatCard from '@/components/ui/stat-card';
import RecentSales from './RecentSales';
import TopProducts from './TopProducts';
import type { PortalDashboardStats } from '@/lib/types';
import { useBranding } from '@/lib/branding-context';
import { formatMoneyMajor } from '@/lib/format';

export default function AdminDashboard({ stats, loading, currentShopId }: { stats: PortalDashboardStats | null; loading: boolean; currentShopId?: string }) {
  const cur = useBranding().branding.currency;
  return (
    <div className='flex flex-col min-h-0 bg-gray-50 dark:bg-zinc-900 px-0 max-w-full mx-auto'>
      <main className="flex-1 px-2 overflow-auto">
        <div className="space-y-6 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Link href="/analytics">
              <StatCard loading={loading} title="Total Revenue" value={loading ? '-' : `${formatMoneyMajor((stats?.salesThisMonth) || 0, cur)}`} subtitle="Total sales last 30 days" icon={<></>} />
            </Link>
            <Link href="/analytics">
              <StatCard loading={loading} title="Total Sales" value={loading ? '-' : `${Math.round((stats?.totalSales) || 0)}`} subtitle="Total transactions" icon={<></>} />
            </Link>
            <Link href="/analytics">
              <StatCard loading={loading} title="Gross Profit" value={loading ? '-' : `${formatMoneyMajor((stats?.totalProfit) || 0, cur)}`} subtitle="Before expenses · last 30 days" icon={<></>} />
            </Link>
            {stats?.netProfit != null && (
              <Link href="/analytics">
                <StatCard loading={loading} title="Net Profit" value={loading ? '-' : `${formatMoneyMajor((stats?.netProfit) || 0, cur)}`} subtitle={`After ${formatMoneyMajor((stats?.totalExpenses) || 0, cur)} expenses`} icon={<></>} />
              </Link>
            )}
            <Link href="/analytics">
              <StatCard loading={loading} title="Low Stock" value={loading ? '-' : stats?.lowStockProducts ?? 0} subtitle="Products need restocking" icon={<></>} />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-2">
            <div className="lg:col-span-2">
              <RecentSales shopId={currentShopId} limit={5} />
            </div>
            <div className="lg:col-span-1">
              <TopProducts products={stats?.topSellingProducts} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
