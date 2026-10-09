'use client';

import { paymentKind, type PaymentPart } from '@/lib/payment-breakdown';
import { formatMoneyMajor } from '@/lib/format';
import { useBranding } from '@/lib/branding-context';
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { Product } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import Link from 'next/link';
import { Eye, Plus, ShoppingCart, DollarSign, TrendingUp, Download, Package, Trash2, X, ArchiveRestore } from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';
import { computePrefillForm } from '@/lib/sales-prefill';
import StatCard from '@/components/ui/stat-card';
import { useTheme } from '@/lib/theme-context';
import { useRouter } from 'next/navigation';
import { Checkbox } from '@/components/ui/checkbox';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import MuiButton from '@mui/material/Button';

type MonthStats = {
  thisCount: number;
  thisRevenue: number;
  /** null when this role can't see cost prices (server nulls costPrice). */
  thisProfit: number | null;
  prevCount: number;
  prevRevenue: number;
};

/** "+12.5% vs last month", or a plain note when last month had nothing to compare against. */
function vsLastMonth(current: number, previous: number): string {
  if (previous <= 0) return 'No sales last month to compare';
  const pct = ((current - previous) / previous) * 100;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}% vs last month`;
}

function SalesEntryContent() {
  const { theme } = useTheme();
  const bgPrimary = theme === 'dark' ? 'bg-black' : 'bg-gray-50';
  // const bgSecondary = theme === 'dark' ? 'bg-gray-900' : 'bg-white';
  const textPrimary = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const borderColor = theme === 'dark' ? 'border-gray-800' : 'border-gray-200';
   const { token, user: authUser } = useHydratedAuth();
   const { currentShop, _hasHydrated } = usePortalStore();
   const cur = useBranding().branding.currency;
   const [mounted, setMounted] = useState(false);
   const [sales, setSales] = useState<SalesRow[]>([]);
   const [stocks, setStocks] = useState<StockRow[]>([]);
   const [monthStats, setMonthStats] = useState<MonthStats | null>(null);
   const [monthRows, setMonthRows] = useState<SalesRow[]>([]);
   const router = useRouter();
   const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';
   // Bulk selection/delete — admin-only. Each id is one SalesEntry row (one
   // product/variant line); deleting removes it from this shop's stock
   // history and gives its quantity back to stock — see sale-delete.server.ts.
   const [selectedSaleIds, setSelectedSaleIds] = useState<Set<string>>(new Set());
   const [confirmDeleteSales, setConfirmDeleteSales] = useState(false);
   const [deletingSales, setDeletingSales] = useState(false);
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
    product?: { name?: string; price?: number; costPrice?: number } | null;
    customerName?: string | null;
    customerPhone?: string | null;
    notes?: string | null;
    quantity: number;
    unitPrice: number;
    totalAmount: number;
    costPrice?: number | null;
    paymentMethod: string;
    paymentBreakdown?: PaymentPart[] | null;
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

  // Real month-to-date stats vs last month. (These cards used to be computed from
  // just the 10 rows on the current page and compared with all of last month.)
  // One request covers both months; split by the viewer's local month boundaries.
  const fetchMonthStats = useCallback(async (shopId: string) => {
    try {
      const now = new Date();
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const qs = new URLSearchParams({ shopId, limit: '10000', offset: '0', from: lastMonthStart.toISOString() });
      const res = await fetch(`/api/portal/sales?${qs.toString()}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) return;
      const rows = json.data as SalesRow[];
      const amount = (r: SalesRow) => Number((r as SalesRow & { baseAmount?: number }).baseAmount ?? r.totalAmount) || 0;
      const thisMonth = rows.filter(r => new Date(r.createdAt) >= thisMonthStart);
      const lastMonth = rows.filter(r => new Date(r.createdAt) < thisMonthStart);
      const costHidden = thisMonth.some(r => r.costPrice == null && r.product?.costPrice == null);
      setMonthRows(thisMonth);
      setMonthStats({
        thisCount: thisMonth.length,
        thisRevenue: thisMonth.reduce((sum, r) => sum + amount(r), 0),
        thisProfit: costHidden ? null : thisMonth.reduce((sum, r) => sum + (r.unitPrice - (r.costPrice ?? r.product?.costPrice ?? 0)) * r.quantity, 0),
        prevCount: lastMonth.length,
        prevRevenue: lastMonth.reduce((sum, r) => sum + amount(r), 0),
      });
    } catch (err) {
      console.error('Failed to load month stats:', err);
    }
  }, [token]);

  useEffect(() => {
    if (!mounted || !token || !_hasHydrated || !currentShop?.id) return;
    void fetchMonthStats(currentShop.id);
  }, [mounted, token, currentShop, _hasHydrated, fetchMonthStats]);

  /** Downloads this month's sales as CSV (the Export button used to do nothing). */
  const exportMonthCsv = () => {
    if (monthRows.length === 0) { toast.error('No sales this month to export'); return; }
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = ['Date', 'Product', 'Quantity', 'Unit price', 'Total', 'Payment method', 'Customer'];
    const lines = monthRows.map(r => [new Date(r.createdAt).toLocaleString(), r.product?.name ?? '', r.quantity, r.unitPrice, r.totalAmount, r.paymentMethod, r.customerName ?? ''].map(esc).join(','));
    const blob = new Blob([[header.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-${new Date().toISOString().slice(0, 7)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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
            // map returned ShopStock rows (which include an embedded Product
            // relation directly from /api/portal/stock) — no separate
            // per-product fetch needed.
            const items: StockRow[] = (data.data || []).map((s: ApiStock) => ({
              id: s.id,
              shopId: s.shopId,
              productId: s.product?.id || s.productId,
              quantity: s.quantity,
              lowStockThreshold: s.lowStockThreshold,
              product: s.Product || s.product || null,
            }));

            setStocks(items);
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
          // Product name/price/costPrice now comes embedded straight from
          // GET /api/portal/sales (s.product) — no more per-row fetch to
          // the long-removed /api/products/[id]. Cost price prefers the
          // SalesEntry's own historical snapshot (what it actually cost at
          // sale time) over the product's current cost, which may have
          // since changed.
          const salesData = (json.data || []).map((s: SalesRow) => {
            // Server nulls both cost fields for roles that can't see cost — keep that as
            // "unknown" rather than 0 (which showed staff a profit equal to the full price).
            if (s.costPrice == null && s.product?.costPrice == null) return { ...s, costPrice: null, ProfitMargin: null };
            const costPrice = s.costPrice || s.product?.costPrice || 0;
            const profit = (s.unitPrice - costPrice) * s.quantity;
            return { ...s, costPrice, ProfitMargin: { profit, costPrice } };
          });

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
          // Same fix as the initial fetch above — product data is embedded
          // by the API now, cost price prefers the SalesEntry's own
          // historical snapshot.
          const salesData = (j.data || []).map((s: SalesRow) => {
            // Server nulls both cost fields for roles that can't see cost — keep that as
            // "unknown" rather than 0 (which showed staff a profit equal to the full price).
            if (s.costPrice == null && s.product?.costPrice == null) return { ...s, costPrice: null, ProfitMargin: null };
            const costPrice = s.costPrice || s.product?.costPrice || 0;
            const profit = (s.unitPrice - costPrice) * s.quantity;
            return { ...s, costPrice, ProfitMargin: { profit, costPrice } };
          });

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

  const toggleSaleSelected = (id: string) => {
    setSelectedSaleIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirmDeleteSalesAction = async () => {
    setConfirmDeleteSales(false);
    setDeletingSales(true);
    try {
      const res = await fetch('/api/portal/sales/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ saleIds: Array.from(selectedSaleIds) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        toast.error(json.error || 'Failed to delete sales');
        return;
      }
      const gone = new Set<string>([...(json.data?.deleted ?? []), ...(json.data?.notFound ?? [])]);
      setSales(prev => prev.filter(s => !gone.has(s.id)));
      setSelectedSaleIds(new Set());
      toast.success(json.message || `${gone.size} removed`);
    } catch (err) {
      console.error('Bulk delete sales error', err);
      toast.error('Failed to delete sales');
    } finally {
      setDeletingSales(false);
    }
  };

  const canSeeCost = sales.some(s => s.costPrice != null);

  const stats = useMemo(() => {
    const availableStock = stocks.filter(s => s.quantity > 0).length;
    const lowStockItems = stocks.filter(s => s.quantity > 0 && s.quantity <= (s.lowStockThreshold ?? 5)).length;
    const outOfStockItems = stocks.filter(s => s.quantity <= 0).length;
    return { availableStock, lowStockItems, outOfStockItems };
  }, [stocks]);

  if (!mounted) return <div className={`flex items-center justify-center min-h-screen ${bgPrimary}`}><div className="text-center"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div><p className={`${textSecondary}`}>Loading...</p></div></div>;

  return (
    <div className={`${bgPrimary} w-full`}>
      <PortalHeader
        backHref="/dashboard"
        title="Sales Management"
        description="Track and manage sales entries across all outlets"
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Sales' }]}
        actions={(
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {isAdmin && (
              <Link href="/sales/trash">
                <Button variant="outline" className={`flex items-center gap-2 ${textPrimary}`}>
                  <ArchiveRestore className="h-4 w-4" />
                  <span className="text-sm">Trash</span>
                </Button>
              </Link>
            )}
            <Button variant="outline" onClick={exportMonthCsv} className={`flex items-center gap-2 ${textPrimary}`}>
              <Download className="h-4 w-4" />
              <span className="text-sm">Export</span>
            </Button>
            <Link href="/sales/new">
              <Button className="bg-[hsl(var(--primary))] text-white flex items-center gap-2 hover:opacity-90"><span className="text-sm">+ New Sale</span></Button>
            </Link>
          </div>
        )}
      />

      {/* Top stat cards: show four including stock availability */}
      <div className="px-2 sm:px-2 py-2 pb-2 w-full">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
         <StatCard
           title="Sales this month"
           value={monthStats ? monthStats.thisCount.toLocaleString() : '—'}
           subtitle={monthStats ? vsLastMonth(monthStats.thisCount, monthStats.prevCount) : 'Loading…'}
           icon={<ShoppingCart className="h-6 w-6 text-blue-600" />}
         />
         <StatCard
           title="Revenue this month"
           value={monthStats ? formatMoneyMajor(monthStats.thisRevenue, cur) : '—'}
           subtitle={monthStats ? vsLastMonth(monthStats.thisRevenue, monthStats.prevRevenue) : 'Loading…'}
           icon={<DollarSign className="h-6 w-6 text-green-600" />}
         />
         <StatCard
           title="Profit this month"
           value={monthStats?.thisProfit != null ? formatMoneyMajor(monthStats.thisProfit, cur) : '—'}
           subtitle={monthStats?.thisProfit != null
             ? `Margin: ${monthStats.thisRevenue > 0 ? ((monthStats.thisProfit / monthStats.thisRevenue) * 100).toFixed(1) : '0.0'}%`
             : 'Cost prices hidden for your role'}
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
           <div className="flex items-center justify-between">
             <CardTitle className="text-xl">Recent Sales</CardTitle>
             {isAdmin && selectedSaleIds.size > 0 && (
               <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                 <span className={`text-sm font-medium ${textPrimary}`}>{selectedSaleIds.size} selected</span>
                 <Button variant="ghost" size="sm" onClick={() => setSelectedSaleIds(new Set())} className="gap-1.5">
                   <X className="h-3.5 w-3.5" />Clear
                 </Button>
                 <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteSales(true)} disabled={deletingSales} className="gap-1.5">
                   <Trash2 className="h-3.5 w-3.5" />
                   {deletingSales ? 'Deleting…' : 'Delete'}
                 </Button>
               </div>
             )}
           </div>
         </CardHeader>
         <CardContent>
           {/* Phones: one card per sale instead of a 10-column table that scrolls sideways. */}
           <ul className="sm:hidden -mx-2 divide-y divide-gray-100 dark:divide-gray-800">
             {sales.map(s => {
               const isSelected = selectedSaleIds.has(s.id);
               const profit = s.ProfitMargin?.profit;
               return (
                 <li key={s.id} className={`flex items-start gap-2 px-2 py-3 ${isSelected ? (theme === 'dark' ? 'bg-purple-900/10' : 'bg-purple-50') : ''}`}>
                   {isAdmin && (
                     <Checkbox checked={isSelected} onChange={() => toggleSaleSelected(s.id)} size="small" sx={{ p: 0.5 }} aria-label={`Select sale for ${s.product?.name || 'product'}`} />
                   )}
                   <button className="min-w-0 flex-1 text-left" onClick={() => router.push(`/sales/new?saleId=${encodeURIComponent(s.id)}`)}>
                     <div className={`font-medium line-clamp-2 ${textPrimary}`}>{s.product?.name || 'Unknown'}</div>
                     <div className={`text-xs ${textSecondary}`}>
                       {s.quantity} × {formatMoneyMajor(s.unitPrice, cur)} · {new Date(s.createdAt).toLocaleDateString()} {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                     </div>
                   </button>
                   <div className="shrink-0 text-right">
                     <div className={`whitespace-nowrap text-sm font-semibold ${textPrimary}`}>{formatMoneyMajor(s.totalAmount, cur)}</div>
                     {canSeeCost && profit != null && (
                       <div className={`whitespace-nowrap text-xs ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                         {profit >= 0 ? '+' : ''}{formatMoneyMajor(profit, cur)}
                       </div>
                     )}
                   </div>
                 </li>
               );
             })}
           </ul>
           <div className="hidden sm:block overflow-x-auto">
             <table className="w-full border-collapse">
               <thead>
                 <tr className={`text-xs font-semibold ${textSecondary} border-b-2 ${borderColor} bg-opacity-50`}>
                  {isAdmin && (
                    <th className="py-4 px-2 w-10">
                      <Checkbox
                        checked={sales.length > 0 && sales.every(s => selectedSaleIds.has(s.id))}
                        indeterminate={sales.some(s => selectedSaleIds.has(s.id)) && !sales.every(s => selectedSaleIds.has(s.id))}
                        onChange={() => {
                          const allSelected = sales.length > 0 && sales.every(s => selectedSaleIds.has(s.id));
                          setSelectedSaleIds(allSelected ? new Set() : new Set(sales.map(s => s.id)));
                        }}
                        size="small"
                        aria-label="Select all"
                      />
                    </th>
                  )}
                  <th className="py-4 px-2 text-left">Date</th>
                  <th className="py-4 px-2 text-left hidden lg:table-cell">ID</th>
                  <th className="py-4 px-2 text-left">Product</th>
                  <th className="py-4 px-2 text-center">Qty</th>
                  {canSeeCost && <th className="py-4 px-2 text-right">Cost Price</th>}
                  <th className="py-4 px-2 text-right">Unit Price</th>
                  {canSeeCost && <th className="py-4 px-2 text-right">Profit</th>}
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

                  const isSelected = selectedSaleIds.has(s.id);
                  return (
                    <tr key={s.id} className={`border-b ${borderColor} hover:bg-opacity-50 ${isSelected ? (theme === 'dark' ? 'bg-purple-900/10' : 'bg-purple-50') : idx % 2 === 0 ? (theme === 'dark' ? 'bg-gray-900 bg-opacity-30' : 'bg-gray-50 bg-opacity-50') : ''}`}>
                      {isAdmin && (
                        <td className="py-3 px-2">
                          <Checkbox checked={isSelected} onChange={() => toggleSaleSelected(s.id)} size="small" aria-label={`Select sale for ${s.product?.name || 'product'}`} />
                        </td>
                      )}
                      <td className={`py-3 px-2 text-sm ${textPrimary}`}>{new Date(s.createdAt).toLocaleDateString()} <span className={`${textSecondary} text-xs`}>{new Date(s.createdAt).toLocaleTimeString()}</span></td>
                      <td className={`py-3 px-2 text-xs text-gray-400 font-mono hidden lg:table-cell`}>{s.id.slice(0, 8)}...</td>
                      <td className={`py-3 px-2 text-sm font-medium ${textPrimary}`}>{s.product?.name || 'Unknown'}</td>
                      <td className={`py-3 px-2 text-sm text-center font-medium ${textPrimary}`}>{s.quantity}</td>
                      {canSeeCost && <td className={`py-3 px-2 text-sm text-right font-medium ${textPrimary}`}>{formatMoneyMajor(costPrice, cur)}</td>}
                      <td className={`py-3 px-2 text-sm text-right font-medium ${textPrimary}`}>{formatMoneyMajor(s.unitPrice, cur)}</td>
                      {canSeeCost && (
                        <td className={`py-3 px-2 text-sm text-right font-medium ${totalProfit > 0 ? 'text-green-600 dark:text-green-400' : totalProfit < 0 ? 'text-red-600 dark:text-red-400' : textSecondary}`}>
                          <div>{formatMoneyMajor(totalProfit, cur)}</div>
                          <div className={`text-xs ${textSecondary}`}>{margin}%</div>
                        </td>
                      )}
                      <td className={`py-3 px-2 text-sm text-right font-semibold ${textPrimary}`}>{formatMoneyMajor(s.totalAmount, cur)}</td>
                      <td className="py-3 px-2 text-center hidden sm:table-cell">
                        <div className="flex flex-wrap items-center justify-center gap-1">
                          {(s.paymentBreakdown?.length ? s.paymentBreakdown : [{ method: s.paymentMethod, amount: null }]).map((part) => {
                            const kind = paymentKind(part.method);
                            const cls = kind === 'mpesa'
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                              : kind === 'card'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
                            return (
                              <span
                                key={part.method}
                                title={part.amount != null ? formatMoneyMajor(part.amount, cur) : undefined}
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${cls}`}
                              >
                                {kind === 'mpesa' ? '📱' : kind === 'card' ? '💳' : '💵'} {kind === 'mpesa' ? 'M-Pesa' : kind === 'card' ? 'Card' : 'Cash'}
                                {part.amount != null && <span className="font-normal">{formatMoneyMajor(part.amount, cur)}</span>}
                              </span>
                            );
                          })}
                        </div>
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
                              router.push(`/sales/new?${params.toString()}`);
                            }}
                            title="Record similar sale"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                          <button
                            aria-label="View/Edit"
                            className={`p-2 rounded hover:bg-opacity-50 transition ${theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200'}`}
                            onClick={() => { router.push(`/sales/new?saleId=${encodeURIComponent(s.id)}`); }}
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

      {/* Bulk Delete Sales Confirmation */}
      <Dialog open={confirmDeleteSales} onClose={() => !deletingSales && setConfirmDeleteSales(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          🗑️ {selectedSaleIds.size === 1 ? 'Delete this sale?' : `Delete ${selectedSaleIds.size} sales?`}
        </DialogTitle>
        <DialogContent>
          <ul className="list-disc pl-5 text-sm space-y-0.5 mb-2">
            {sales.filter(s => selectedSaleIds.has(s.id)).slice(0, 5).map(s => (
              <li key={s.id} className="truncate">{s.product?.name || 'Unknown'} — {formatMoneyMajor(s.totalAmount, cur)}</li>
            ))}
          </ul>
          {selectedSaleIds.size > 5 && (
            <p className={`text-xs ${textSecondary} mb-2`}>…and {selectedSaleIds.size - 5} more</p>
          )}
          <DialogContentText>
            The units sold will be added back to stock. Deleted sales are recoverable from Trash for 90 days, then removed for good. A sale that already has a tax invoice on file can’t be deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <MuiButton onClick={() => setConfirmDeleteSales(false)} variant="outlined" size="small" disabled={deletingSales}>Cancel</MuiButton>
          <MuiButton onClick={() => void confirmDeleteSalesAction()} variant="contained" size="small" disabled={deletingSales} sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>{deletingSales ? 'Deleting…' : 'Delete'}</MuiButton>
        </DialogActions>
      </Dialog>
     </div>
   );
 }

 export default function SalesEntryPage() {
   return (
     <SalesEntryContent />
   );
 }
