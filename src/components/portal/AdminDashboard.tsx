'use client';

import Link from 'next/link';
import StatCard from '@/components/ui/stat-card';
import RecentSales from './RecentSales';
import TopProducts from './TopProducts';
import type { PortalDashboardStats } from '@/lib/types';

export default function AdminDashboard({ stats, loading, currentShopId }: { stats: PortalDashboardStats | null; loading: boolean; currentShopId?: string }) {
  return (
    <div className='flex flex-col min-h-0 bg-gray-50 dark:bg-zinc-900 px-0 max-w-full mx-auto'>
      <main className="flex-1 px-2 overflow-auto">
        <div className="space-y-6 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Link href="/analytics">
              <StatCard loading={loading} title="Total Revenue" value={loading ? '-' : `KES ${((stats?.salesThisMonth) || 0).toLocaleString()}`} subtitle="Total sales this month" icon={<></>} />
            </Link>
            <Link href="/analytics">
              <StatCard loading={loading} title="Total Sales" value={loading ? '-' : `${Math.round((stats?.totalSales) || 0)}`} subtitle="Total transactions" icon={<></>} />
            </Link>
            <Link href="/analytics">
              <StatCard loading={loading} title="Total Profit" value={loading ? '-' : `KES ${((stats?.totalProfit) || 0).toLocaleString()}`} subtitle="Profit this month" icon={<></>} />
            </Link>
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
