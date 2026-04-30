'use client';

import { useEffect, useState, useMemo } from 'react';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import type { PortalDashboardStats, User } from '@/lib/types';
import AdminDashboard from '@/components/portal/AdminDashboard';
import ShopDashboard from '@/components/portal/ShopDashboard';
import PortalHeader from '@/components/portal/PortalHeader';

function PortalDashboardContent() {
  const { user: authUser, token } = useHydratedAuth();
  const { currentShop, currentPortalUser, _hasHydrated } = usePortalStore();
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<PortalDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  // Type-safe role helpers (authUser.role may have a narrower inferred type in some contexts)
  const role = useMemo(() => (authUser?.role as User['role'] | undefined) ?? undefined, [authUser?.role]);
  const isAdminOrSuper = useMemo(() => role === 'admin' || role === 'super_admin', [role]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !token || !_hasHydrated) return;

    // Portal user fetches own shop stats
    const fetchForShop = async (shopId: string) => {
      try {
        const response = await fetch(`/api/portal/dashboard/stats?shopId=${shopId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        if (!response.ok) return null;
        const json = await response.json();
        if (!json.success) return null;
        return json.data as PortalDashboardStats;
      } catch (err) {
        console.error('Failed to fetch shop stats', err);
        return null;
      }
    };

    const loadStats = async () => {
      setLoading(true);
      try {
        if (!isAdminOrSuper) {
          if (!currentShop) return;
          const s = await fetchForShop(currentShop.id);
          if (s) setStats(s);
          setLoading(false);
          return;
        }

        // Admin: fetch all shops and aggregate stats
        const shopsRes = await fetch('/api/portal/shops', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        let shopsList: { id: string; name?: string }[] = [];
        if (shopsRes.ok) {
          const j = await shopsRes.json();
          if (j?.success && Array.isArray(j.data)) shopsList = j.data;
        }

        if (shopsList.length === 0) {
          setStats(null);
          setLoading(false);
          return;
        }

        // Fetch stats in parallel for each shop
        const statsResponses = await Promise.all(shopsList.map(s => fetchForShop(s.id)));
        // Aggregate
        let totalSales = 0;
        let totalProfit = 0;
        let salesToday = 0;
        let averageMarginAcc = 0;
        let marginCount = 0;
        let lowStockProducts = 0;
        const topProductsMap = new Map<string, { name: string; quantity: number; sales: number }>();

        for (const s of statsResponses) {
          if (!s) continue;
          totalSales += s.salesThisMonth || 0;
          totalProfit += s.totalProfit || 0;
          salesToday += s.salesToday || 0;
          // averageMargin is always a number in the API shape; accumulate and count
          averageMarginAcc += s.averageMargin;
          marginCount++;
          lowStockProducts += s.lowStockProducts || 0;

          (s.topSellingProducts || []).forEach(p => {
            const key = p.name;
            const existing = topProductsMap.get(key);
            if (existing) {
              existing.quantity += p.quantity;
              existing.sales += p.sales;
            } else {
              topProductsMap.set(key, { name: p.name, quantity: p.quantity, sales: p.sales });
            }
          });
        }

        const averageMargin = marginCount > 0 ? averageMarginAcc / marginCount : 0;
        const topSellingProducts = Array.from(topProductsMap.values()).sort((a, b) => b.sales - a.sales).slice(0, 5);

        setStats({
          totalSales,
          totalProfit,
          averageMargin,
          lowStockProducts,
          topSellingProducts,
          salesToday,
          salesThisMonth: totalSales,
        });
      } catch (err) {
        console.error('Failed to load aggregated stats', err);
      } finally {
        setLoading(false);
      }
    };

    void loadStats();
  }, [mounted, currentShop, token, isAdminOrSuper, _hasHydrated]);

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600">Loading portal...</p>
        </div>
      </div>
    );
  }

  // For admins and super_admins, don't require currentShop and currentPortalUser
  if (!isAdminOrSuper && (!currentShop || !currentPortalUser)) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-gray-600">Loading portal...</p>
        </div>
      </div>
    );
  }

  // Admin view with full-width content
  if (isAdminOrSuper) {
    return (
      <div>
        <PortalHeader title="Dashboard" description="Admin summary and metrics" backHref="/portal" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Dashboard' }]} />
        <AdminDashboard stats={stats} loading={loading} currentShopId={currentShop?.id} />
      </div>
    );
  }

  // Portal user view
  if (!currentShop || !currentPortalUser) {
    return null; // guarded earlier, but keep safe
  }

  const shop = currentShop!;
  const portalUser = currentPortalUser!;

  return (
    <div>
      <PortalHeader title="Dashboard" description={`Overview for ${shop.name || 'your shop'}`} backHref="/portal" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Dashboard' }]} />
      <ShopDashboard stats={stats} loading={loading} shopId={shop.id} shopName={shop.name} portalUserPosition={portalUser.position} />
    </div>
  );
}

export default function Page() {
  return <PortalDashboardContent />;
}
