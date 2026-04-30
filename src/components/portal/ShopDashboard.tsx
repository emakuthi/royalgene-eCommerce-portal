'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import StatCard from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';

import type { PortalDashboardStats } from '@/lib/types';

export default function ShopDashboard({ stats, loading, shopName, portalUserPosition }: { stats: PortalDashboardStats | null; loading: boolean; shopId?: string; shopName?: string; portalUserPosition?: string }) {
  return (
    <div className="flex flex-col min-h-0 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* Header */}
      <div className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Portal Dashboard</h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">{shopName} • {portalUserPosition}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6 space-y-6 overflow-auto flex-1">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Link href="/portal/analytics">
            <StatCard loading={loading} title="Sales Today" value={loading ? '-' : `KES ${(stats?.salesToday || 0).toLocaleString()}`} subtitle="Today's transactions" icon={<></>} />
          </Link>
          <Link href="/portal/analytics">
            <StatCard loading={loading} title="Profit" value={loading ? '-' : `KES ${(stats?.totalProfit || 0).toLocaleString()}`} subtitle="Total profit this month" icon={<></>} />
          </Link>
          <Link href="/portal/analytics">
            <StatCard loading={loading} title="Avg Margin" value={loading ? '-' : `${(stats?.averageMargin ?? 0).toFixed(1)}%`} subtitle="Average profit margin" icon={<></>} />
          </Link>
          <Link href="/portal/analytics">
            <StatCard loading={loading} title="Low Stock" value={loading ? '-' : stats?.lowStockProducts ?? 0} subtitle="Products need restocking" icon={<></>} />
          </Link>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Quick Access</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="border-2 border-transparent hover:border-blue-400 cursor-pointer transition">
              <Link href="/portal/analytics">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg" />
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Analytics</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">View sales & profit reports</p>
                    </div>
                  </div>
                </CardContent>
              </Link>
            </Card>

            <Card className="border-2 border-transparent hover:border-purple-400 cursor-pointer transition">
              <Link href="/portal/stock">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-lg" />
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Manage Stock</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Update inventory levels</p>
                    </div>
                  </div>
                </CardContent>
              </Link>
            </Card>

            <Card className="border-2 border-transparent hover:border-green-400 cursor-pointer transition">
              <Link href="/portal/sales">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-green-100 dark:bg-green-900 rounded-lg" />
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">Record Sale</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">Enter transactions</p>
                    </div>
                  </div>
                </CardContent>
              </Link>
            </Card>
          </div>
        </div>

        {/* Low Stock Alerts */}
        {stats && stats.lowStockProducts > 0 && (
          <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950">
            <CardContent>
              <p className="text-amber-800 dark:text-amber-200">
                {stats.lowStockProducts} product{stats.lowStockProducts !== 1 ? 's' : ''} need restocking.
              </p>
              <Link href="/portal/stock">
                <Button className="mt-3 bg-amber-600 hover:bg-amber-700" size="sm">
                  View Low Stock Items
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Top Selling Products */}
        {stats && stats.topSellingProducts.length > 0 && (
          <Card>
            <CardContent>
              <div className="space-y-3">
                {stats.topSellingProducts.map((product, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {product.quantity} sold
                      </p>
                    </div>
                    <div className="text-right font-semibold text-green-600">
                      KES {product.sales.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
