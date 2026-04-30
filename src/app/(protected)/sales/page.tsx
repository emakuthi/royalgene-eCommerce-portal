'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Product } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import Link from 'next/link';
import { Eye, Plus, ShoppingCart, DollarSign, TrendingUp, Download, Sliders, Package } from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';
import { computePrefillForm } from '@/lib/sales-prefill';
import StatCard from '@/components/ui/stat-card';
import { useTheme } from '@/lib/theme-context';
import { useRouter } from 'next/navigation';

function formatCurrency(amount: number) {
  return amount.toFixed(2);
}

function SalesEntryContent() {
  const { theme } = useTheme();
  const bgPrimary = theme === 'dark' ? 'bg-black' : 'bg-gray-50';
  // const bgSecondary = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textPrimary = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const borderColor = theme === 'dark' ? 'border-gray-800' : 'border-gray-200';
   const { token } = useHydratedAuth();
   const { currentShop, _hasHydrated } = usePortalStore();
   const [mounted, setMounted] = useState(false);
   const [sales, setSales] = useState<SalesRow[]>([]);
   const [stocks, setStocks] = useState<StockRow[]>([]);
   const [prevMonthSales, setPrevMonthSales] = useState(0);
   const [prevMonthRevenue, setPrevMonthRevenue] = useState(0);
   const router = useRouter();
  // Pagination for the recent sales listing
  const [page, setPage] = useState(0);
  const limit = 10;
  const offset = page * limit;

  // Local UI type that matches API response (SalesEntry with related data)
  type SalesRow = {
    id: string;
    createdAt: string;
    shopId?: string | null;
    portalUserId?: string | null;
    productId: string;
    product?: { name?: string; price?: number } | null;
    customerName?: string | null;
    customerPhone?: string | null;
    notes?: string | null;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    costPrice?: number | null;
    paymentMethod: string;
    ProfitMargin?: { profit?: number; costPrice?: number } | null;
  };

  // Use shop stocks (with Product relation) so we can select products available in the shop
  type StockRow = {
    id: string;
    shopId: string;
    productId: string;
    quantity: number;
    lowStockThreshold: number;
    product?: Product | null;
  };


  // API response shape for shop stock rows (from /api/portal/stock)
  type ApiStock = {
    id: string;
    shopId: string;
    productId: string;
    quantity: number;
    lowStockThreshold?: number;
    Product?: Product | null; // some endpoints use uppercase relation
    product?: Product | null; // some endpoints use lowercase relation
  };

  useEffect(() => setMounted(true), []);

  // Helper function to calculate previous month's data - memoized with useCallback
  const fetchPreviousMonthData = useCallback(async (shopId: string) => {
    try {
      // Calculate date range for previous month
      const now = new Date();
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0); // Last day of previous month
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1); // First day of previous month

      const qs = new URLSearchParams();
      qs.set('shopId', shopId);
      qs.set('limit', '1000'); // Get all sales in previous month
      qs.set('offset', '0');

      const res = await fetch(`/api/portal/sales?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        // Filter for previous month only
        const prevMonthData = (json.data || []).filter((s: SalesRow) => {
          const saleDate = new Date(s.createdAt);
          return saleDate >= lastMonthStart && saleDate <= lastMonthEnd;
        });

        const prevSalesCount = prevMonthData.length;
        const prevRevenue = prevMonthData.reduce((sum: number, s: SalesRow) => sum + (s.totalAmount || 0), 0);

        setPrevMonthSales(prevSalesCount);
        setPrevMonthRevenue(prevRevenue);
      }
    } catch (err) {
      console.error('Failed to fetch previous month data:', err);
      setPrevMonthSales(0);
      setPrevMonthRevenue(0);
    }
  }, [token]);

  useEffect(() => {
    if (!mounted || !token || !_hasHydrated || !currentShop?.id) return;
    fetchPreviousMonthData(currentShop.id);
  }, [mounted, token, currentShop, _hasHydrated, fetchPreviousMonthData]);

  useEffect(() => {
    if (!mounted || !token || !_hasHydrated) return;

    const fetchStocks = async () => {
      try {
        const shopId = currentShop?.id;
        if (!shopId) return;
        const response = await fetch(`/api/portal/stock?shopId=${shopId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            // map returned ShopStock rows (which include Product relation)
            const items: StockRow[] = (data.data || []).map((s: ApiStock) => ({
              id: s.id,
              shopId: s.shopId,
              productId: s.product?.id || s.productId,
              quantity: s.quantity,
              lowStockThreshold: s.lowStockThreshold,
              product: s.Product || s.product || null,
            }));

            // If any product is missing authoritative price, fetch product records from /api/products/:id
            const uniqueProductIds = Array.from(new Set(items.map(i => i.productId).filter(Boolean)));
            if (uniqueProductIds.length > 0) {
              const productsById: Record<string, Product> = {};
              await Promise.all(uniqueProductIds.map(async (pid) => {
                try {
                  const r = await fetch(`/api/products/${pid}`);
                  if (!r.ok) return;
                  const j = await r.json();
                  if (j && j.success && j.data) {
                    productsById[pid] = j.data;
                  }
                } catch (err) {
                  // ignore individual product fetch failures; we'll fall back to relation data if present
                  console.warn('Failed to fetch product', pid, err);
                }
              }));

              // Merge authoritative product data into stock rows (prefer admin product record)
              const merged: StockRow[] = items.map(it => ({
                ...it,
                product: productsById[it.productId] || it.product || null,
              }));

              setStocks(merged);
            } else {
              // no products (unlikely) - still set stocks
              setStocks(items);
           }
         }
       }
      } catch (err) {
        console.error('Failed to fetch stocks:', err);
        toast.error('Failed to load stock items');
      }
    };

    const fetchSales = async () => {
      try {
        const shopId = currentShop?.id;
        if (!shopId) return;
        const qs = new URLSearchParams();
        qs.set('shopId', shopId);
        qs.set('limit', String(limit));
        qs.set('offset', String(offset));
        const res = await fetch(`/api/portal/sales?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          let salesData = json.data || [];

          // Fetch product details (name, cost price) for accurate display and profit calculation
          const uniqueProductIds = Array.from(new Set(salesData.map((s: SalesRow) => s.productId).filter(Boolean)));
          if (uniqueProductIds.length > 0) {
            const productsById: Record<string, Product> = {};
            await Promise.all(uniqueProductIds.map(async (pid: unknown) => {
              try {
                const pidStr = String(pid);
                const r = await fetch(`/api/products/${pidStr}`);
                if (!r.ok) return;
                const j = await r.json();
                if (j && j.success && j.data) {
                  productsById[pidStr] = j.data;
                }
              } catch (err) {
                console.warn('Failed to fetch product', pid, err);
              }
            }));

            // Merge product data (name, cost price) into sales rows
            salesData = salesData.map((s: SalesRow) => {
              const productData = productsById[s.productId];
              const costPrice = productData?.costPrice || s.costPrice || 0;
              const profitPerUnit = s.unitPrice - costPrice;
              const profit = profitPerUnit * s.quantity;

              return {
                ...s,
                product: {
                  name: productData?.name || s.product?.name || 'Unknown Product',
                  price: productData?.price || s.product?.price,
                },
                costPrice: costPrice,
                // Store calculated profit in ProfitMargin for consistency
                ProfitMargin: {
                  profit: profit,
                  costPrice: costPrice,
                },
              };
            });
          }

          setSales(salesData);
        } else {
          setSales([]);
        }
      } catch (err) {
        console.error('Failed to fetch sales:', err);
        setSales([]);
      }
    };

    void fetchStocks();
    void fetchSales();
  }, [mounted, token, currentShop, offset, _hasHydrated]);
  // Re-run sales fetch when page changes
  useEffect(() => {
    if (!mounted || !token || !currentShop || !_hasHydrated) return;
    let canceled = false;
    const qs = new URLSearchParams();
    qs.set('shopId', currentShop.id);
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    const fetchPage = async () => {
      try {
        const res = await fetch(`/api/portal/sales?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const j = await res.json();
        if (!canceled && j?.success && Array.isArray(j.data)) {
          let salesData = j.data || [];

          // Fetch product details (name, cost price) for accurate display and profit calculation
          const uniqueProductIds = Array.from(new Set(salesData.map((s: SalesRow) => s.productId).filter(Boolean)));
          if (uniqueProductIds.length > 0) {
            const productsById: Record<string, Product> = {};
            await Promise.all(uniqueProductIds.map(async (pid: unknown) => {
              try {
                const pidStr = String(pid);
                const r = await fetch(`/api/products/${pidStr}`);
                if (!r.ok) return;
                const j = await r.json();
                if (j && j.success && j.data) {
                  productsById[pidStr] = j.data;
                }
              } catch (err) {
                console.warn('Failed to fetch product', pid, err);
              }
            }));

            // Merge product data (name, cost price) into sales rows
            salesData = salesData.map((s: SalesRow) => {
              const productData = productsById[s.productId];
              const costPrice = productData?.costPrice || s.costPrice || 0;
              const profitPerUnit = s.unitPrice - costPrice;
              const profit = profitPerUnit * s.quantity;

              return {
                ...s,
                product: {
                  name: productData?.name || s.product?.name || 'Unknown Product',
                  price: productData?.price || s.product?.price,
                },
                costPrice: costPrice,
                // Store calculated profit in ProfitMargin for consistency
                ProfitMargin: {
                  profit: profit,
                  costPrice: costPrice,
                },
              };
            });
          }

          setSales(salesData);
        }
      } catch (err) {
        if (!canceled) {
          console.error('Failed to fetch paged sales', err);
          setSales([]);
        }
      }
    };
    void fetchPage();
    return () => { canceled = true; };
  }, [page, mounted, token, currentShop, offset, _hasHydrated]);

  const stats = useMemo(() => {
    const totalSales = sales.length;
    const totalRevenue = sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0);

    // Use the pre-calculated profit from ProfitMargin (always populated from fetchSales/fetchPage)
    const totalProfit = sales.reduce((sum, s) => {
      return sum + (s.ProfitMargin?.profit || 0);
    }, 0);

    const availableStock = stocks.filter(s => s.quantity > 0).length;
    const lowStockItems = stocks.filter(s => s.quantity > 0 && s.quantity <= (s.lowStockThreshold ?? 5)).length;
    const outOfStockItems = stocks.filter(s => s.quantity <= 0).length;
    return { totalSales, totalRevenue, totalProfit, availableStock, lowStockItems, outOfStockItems };
  }, [sales, stocks]);

  // Calculate percentage changes for month-over-month comparison
  const salesChange = prevMonthSales > 0
    ? (((stats.totalSales - prevMonthSales) / prevMonthSales) * 100).toFixed(1)
    : stats.totalSales > 0 ? '100.0' : '0.0';

  const revenueChange = prevMonthRevenue > 0
    ? (((stats.totalRevenue - prevMonthRevenue) / prevMonthRevenue) * 100).toFixed(1)
    : stats.totalRevenue > 0 ? '100.0' : '0.0';

  const salesChangePrefix = parseFloat(salesChange) >= 0 ? '+' : '';
  const revenueChangePrefix = parseFloat(revenueChange) >= 0 ? '+' : '';

  if (!mounted) return <div className={`flex items-center justify-center min-h-screen ${bgPrimary}`}><div className="text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div><p className={`${textSecondary}`}>Loading...</p></div></div>;

  return (
    <div className={`${bgPrimary} w-full`}>
      <PortalHeader
        backHref="/dashboard"
        title="Sales Management"
        description="Track and manage sales entries across all outlets"
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Sales' }]}
        actions={(
          <div className="flex items-center gap-3">
            <Button variant="outline" className={`flex items-center gap-2 ${textPrimary}`}>
              <Download className="h-4 w-4" />
              <span className="text-sm">Export</span>
            </Button>
            <Button variant="outline" className={`flex items-center gap-2 ${textPrimary}`}>
              <Sliders className="h-4 w-4" />
              <span className="text-sm">Filter</span>
            </Button>
            <Link href="/sales/new">
              <Button className={`bg-[hsl(var(--primary))] bg-opacity-10 flex items-center gap-2 ${textPrimary}`}><span className="text-sm">+ New Sale</span></Button>
            </Link>
          </div>
        )}
      />

      {/* Top stat cards: show four including stock availability */}
      <div className="px-2 sm:px-2 py-2 pb-2 w-full">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
         <StatCard
           title="Total Sales"
           value={stats.totalSales}
           subtitle={`${salesChangePrefix}${salesChange}% from last month`}
           icon={<ShoppingCart className="h-6 w-6 text-blue-600" />}
         />
         <StatCard
           title="Total Revenue"
           value={formatCurrency(stats.totalRevenue)}
           subtitle={`${revenueChangePrefix}${revenueChange}% from last month`}
           icon={<DollarSign className="h-6 w-6 text-green-600" />}
         />
         <StatCard
           title="Total Profit"
           value={formatCurrency(stats.totalProfit)}
           subtitle={`Margin: ${stats.totalRevenue > 0 ? ((stats.totalProfit / stats.totalRevenue) * 100).toFixed(1) : '0.0'}%`}
           icon={<TrendingUp className="h-6 w-6 text-purple-600" />}
         />
         <StatCard
           title="Stock Available"
           value={stats.availableStock}
           subtitle={`${stats.lowStockItems} low, ${stats.outOfStockItems} out`}
           icon={<Package className="h-6 w-6 text-orange-600" />}
         />
       </div>
      </div>
       {/* Recent Sales table */}
       <div className="px-2 sm:px-2 pb-6 w-full">
        <Card>
         <CardHeader>
           <CardTitle className="text-xl">Recent Sales</CardTitle>
         </CardHeader>
         <CardContent>
           <div className="overflow-x-auto">
             <table className="w-full border-collapse">
               <thead>
                 <tr className={`text-xs font-semibold ${textSecondary} border-b-2 ${borderColor} bg-opacity-50`}>
                  <th className="py-4 px-2 text-left">Date</th>
                  <th className="py-4 px-2 text-left hidden lg:table-cell">ID</th>
                  <th className="py-4 px-2 text-left">Product</th>
                  <th className="py-4 px-2 text-center">Qty</th>
                  <th className="py-4 px-2 text-right">Cost Price</th>
                  <th className="py-4 px-2 text-right">Unit Price</th>
                  <th className="py-4 px-2 text-right">Profit</th>
                  <th className="py-4 px-2 text-right">Total</th>
                  <th className="py-4 px-2 text-center hidden sm:table-cell">Payment</th>
                  <th className="py-4 px-2 text-center">Actions</th>
                 </tr>
               </thead>
               <tbody>
                {sales.map((s, idx) => {
                  // Use pre-calculated profit from ProfitMargin or calculate from cost price
                  const totalProfit = s.ProfitMargin?.profit !== undefined
                    ? s.ProfitMargin.profit
                    : ((s.unitPrice - (s.costPrice || 0)) * s.quantity);
                  const margin = s.totalAmount > 0 ? ((totalProfit / s.totalAmount) * 100).toFixed(1) : '0.0';
                  const costPrice = s.costPrice || 0;

                  return (
                    <tr key={s.id} className={`border-b ${borderColor} hover:bg-opacity-50 ${idx % 2 === 0 ? (theme === 'dark' ? 'bg-gray-900 bg-opacity-30' : 'bg-gray-50 bg-opacity-50') : ''}`}>
                      <td className={`py-3 px-2 text-sm ${textPrimary}`}>{new Date(s.createdAt).toLocaleDateString()} <span className={`${textSecondary} text-xs`}>{new Date(s.createdAt).toLocaleTimeString()}</span></td>
                      <td className={`py-3 px-2 text-xs text-gray-400 font-mono hidden lg:table-cell`}>{s.id.slice(0, 8)}...</td>
                      <td className={`py-3 px-2 text-sm font-medium ${textPrimary}`}>{s.product?.name || 'Unknown'}</td>
                      <td className={`py-3 px-2 text-sm text-center font-medium ${textPrimary}`}>{s.quantity}</td>
                      <td className={`py-3 px-2 text-sm text-right font-medium ${textPrimary}`}>{formatCurrency(costPrice)}</td>
                      <td className={`py-3 px-2 text-sm text-right font-medium ${textPrimary}`}>{formatCurrency(s.unitPrice)}</td>
                      <td className={`py-3 px-2 text-sm text-right font-medium ${totalProfit > 0 ? 'text-green-600 dark:text-green-400' : totalProfit < 0 ? 'text-red-600 dark:text-red-400' : textSecondary}`}>
                        <div>{formatCurrency(totalProfit)}</div>
                        <div className={`text-xs ${textSecondary}`}>{margin}%</div>
                      </td>
                      <td className={`py-3 px-2 text-sm text-right font-semibold ${textPrimary}`}>{formatCurrency(s.totalAmount)}</td>
                      <td className="py-3 px-2 text-center hidden sm:table-cell">
                        <span className={`px-2 py-1 rounded text-xs font-medium bg-[hsl(var(--primary))] bg-opacity-10 ${textPrimary}`}>
                          {s.paymentMethod === 'mobile_money' ? 'M-Pesa' : (s.paymentMethod[0].toUpperCase() + s.paymentMethod.slice(1))}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            aria-label={`Record sale for ${s.product?.name || s.productId}`}
                            className={`p-2 rounded hover:bg-opacity-50 transition ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                            onClick={() => {
                              const prefill = computePrefillForm({ productId: s.productId, unitPrice: s.unitPrice, paymentMethod: s.paymentMethod }, stocks);
                              const params = new URLSearchParams();
                              if (prefill.shopStockId) params.set('shopStockId', prefill.shopStockId);
                              if (prefill.productId) params.set('productId', prefill.productId);
                              if (prefill.unitPrice) params.set('unitPrice', String(prefill.unitPrice));
                              if (prefill.paymentMethod) params.set('paymentMethod', prefill.paymentMethod);
                              router.push(`/portal/sales/new?${params.toString()}`);
                            }}
                            title="Record similar sale"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                          <button
                            aria-label="View/Edit"
                            className={`p-2 rounded hover:bg-opacity-50 transition ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                            onClick={() => { router.push(`/portal/sales/new?saleId=${encodeURIComponent(s.id)}`); }}
                            title="Edit sale"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
               </tbody>
             </table>
           </div>
           {sales.length === 0 && (
             <div className={`text-center py-8 ${textSecondary}`}>
               <p className="text-sm">No sales to display</p>
             </div>
           )}
           {/* Pagination controls */}
           <div className="mt-6 flex items-center justify-between">
             <div className={`text-sm ${textSecondary}`}>Page {page + 1} • Showing {sales.length} of {limit}</div>
             <div className="flex items-center gap-2">
               <Button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} variant="outline" size="sm">Prev</Button>
               <Button onClick={() => setPage(p => p + 1)} disabled={sales.length < limit} variant="outline" size="sm">Next</Button>
             </div>
           </div>
          </CardContent>
        </Card>
      </div>
     </div>
   );
 }

 export default function SalesEntryPage() {
   return (
     <SalesEntryContent />
   );
 }
