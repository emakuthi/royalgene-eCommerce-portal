'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useHydratedAuth } from '@/lib/hooks';
import { useBranding } from '@/lib/branding-context';
import { formatMoney } from '@/lib/currency';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import { useTheme } from '@/lib/theme-context';
import {
  TrendingUp,
  DollarSign,
  ShoppingCart,
  Search,
  Activity,
  BarChart3,
  PieChartIcon,
  Package,
  CalendarDays,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  LayoutGrid,
  Receipt,
  Wallet,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import PortalHeader from '@/components/portal/PortalHeader';
import { FeatureGate } from '@/components/entitlements/FeatureGate';
import { FeatureCode } from '@/lib/entitlements/feature-codes';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
interface SalesData {
  date: string;
  sales: number;
  transactions: number;
  profit: number;
  avgTransactionValue: number;
}

interface ProductAnalytics {
  id: string;
  name: string;
  quantity: number;
  totalSales: number;
  profit: number;
  profitMargin: number;
  costPrice?: number;
}

interface RawSalesItem {
  date: string;
  sales: number;
  transactions?: number;
  profit?: number;
}

interface RawProductItem {
  id?: string;
  name?: string;
  quantity?: number;
  sales?: number;
  totalSales?: number;
  profit?: number;
  costPrice?: number;
}

interface ShopValuation {
  shopId: string;
  shopName: string;
  units: number;
  retailValue: number;
  costValue: number | null;
}

interface InventoryValuation {
  totalUnits: number;
  totalRetailValue: number;
  totalCostValue: number | null;
  shops: ShopValuation[];
}

interface PnlMonth {
  month: string; // YYYY-MM
  revenue: number;
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

/** 600000 → "600K", 1250000 → "1.3M" — full numbers squeezed the plot area on phones. */
const compactTick = (v: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const DATE_RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
// SalesEntry.totalAmount / Product.price / .costPrice are all stored in
// MAJOR KES units already (e.g. 1600 means Ksh 1,600, never cents) — this
// used to divide by 100 as if they were cents, quietly showing every real
// figure 100x too small once any actual data reached this page.
function formatCurrency(amount: number, currency: string = 'KES') {
  return formatMoney(amount, currency);
}

function TrendIndicator({ value, suffix = '%' }: { value: number; suffix?: string }) {
  if (value > 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400 text-xs font-medium">
        <ArrowUpRight className="h-3.5 w-3.5" />
        {value.toFixed(1)}{suffix}
      </span>
    );
  if (value < 0)
    return (
      <span className="inline-flex items-center gap-0.5 text-red-500 dark:text-red-400 text-xs font-medium">
        <ArrowDownRight className="h-3.5 w-3.5" />
        {Math.abs(value).toFixed(1)}{suffix}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 text-gray-400 text-xs font-medium">
      <Minus className="h-3.5 w-3.5" />
      0{suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Card                                                          */
/* ------------------------------------------------------------------ */
function KPICard({
  title,
  value,
  subtitle,
  icon,
  iconBg,
  loading,
}: {
  title: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  icon: React.ReactNode;
  iconBg: string;
  loading?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          <div className={`shrink-0 rounded-xl p-2.5 ${iconBg}`}>{icon}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400 truncate">{title}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white truncate">
              {loading ? (
                <span className="inline-block h-7 w-28 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              ) : (
                value
              )}
            </p>
            {subtitle && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Tooltip style (shared)                                            */
/* ------------------------------------------------------------------ */
function useTooltipStyle() {
  const { theme } = useTheme();
  return {
    backgroundColor: theme === 'dark' ? '#1f2937' : '#ffffff',
    border: `1px solid ${theme === 'dark' ? '#374151' : '#e5e7eb'}`,
    borderRadius: '10px',
    color: theme === 'dark' ? '#f3f4f6' : '#111827',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
    padding: '10px 14px',
    fontSize: '13px',
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function AnalyticsPage() {
  const { token, user: authUser } = useHydratedAuth();
  const cur = useBranding().branding.currency; // tenant base
  // Reporting-currency: display-only conversion of base figures. Does not
  // change stored data — just how totals are presented.
  // null = follow the tenant base currency (which may finish loading after first render);
  // set once the user picks one. Was useState(cur), which froze an undefined/early value.
  const [pickedCurrency, setReportingCurrency] = useState<string | null>(null);
  const reportingCurrency = pickedCurrency ?? cur;
  const [reportCurrencies, setReportCurrencies] = useState<string[]>([cur]);
  const [reportRate, setReportRate] = useState(1); // base → reportingCurrency

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch('/api/currencies/active', { headers: { Authorization: `Bearer ${token}` } });
        const j = await res.json();
        if (j?.success && Array.isArray(j.data)) setReportCurrencies(j.data.map((c: { code: string }) => c.code));
      } catch { /* keep default */ }
    })();
  }, [token]);

  useEffect(() => {
    if (!token || reportingCurrency === cur) { setReportRate(1); return; }
    (async () => {
      try {
        const res = await fetch(`/api/exchange-rates/${cur}/${reportingCurrency}`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await res.json();
        setReportRate(j?.success && j.data?.rate ? Number(j.data.rate) : 1);
      } catch { setReportRate(1); }
    })();
  }, [reportingCurrency, cur, token]);

  /** Format a BASE-currency amount in the selected reporting currency (display-only). */
  const fmt = (base: number) => formatCurrency((base || 0) * reportRate, reportingCurrency);
  const { currentShop, _hasHydrated } = usePortalStore();
  const { theme } = useTheme();
  const tooltipStyle = useTooltipStyle();

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('month');
  const [searchTerm, setSearchTerm] = useState('');
  const [salesData, setSalesData] = useState<SalesData[]>([]);
  const [topProducts, setTopProducts] = useState<ProductAnalytics[]>([]);
  const [shopName, setShopName] = useState('Analytics');
  const [summary, setSummary] = useState({
    totalSales: 0,
    totalProfit: 0,
    avgMargin: 0,
    totalExpenses: 0,
    netProfit: 0,
    netMargin: 0,
    totalTransactions: 0,
    avgTransactionValue: 0,
    bestDay: 0,
    worstDay: 0,
  });

  // Monthly profit-and-loss trend (gross vs net, expenses) — see /api/portal/analytics/pnl
  const [pnl, setPnl] = useState<PnlMonth[]>([]);
  // Profit/expense figures are owner/admin-only (API returns null otherwise).
  const [canSeeProfit, setCanSeeProfit] = useState(true);

  // Org-wide stock on hand and its value, per shop — admins only, and
  // deliberately independent of dateRange/currentShop (see the API route's
  // own doc comment: a snapshot, not a range).
  const [inventory, setInventory] = useState<InventoryValuation | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);

  const gridStroke = theme === 'dark' ? '#374151' : '#e5e7eb';
  const axisStroke = theme === 'dark' ? '#9ca3af' : '#6b7280';

  /* ---- lifecycle ---- */
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !_hasHydrated || !token) return;

    if (authUser?.role === 'portal_user' && !currentShop) {
      setLoading(false);
      return;
    }

    const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';
    // Admin + "All Shops" (currentShop === null) used to stop here entirely —
    // set a "Platform Analytics" label and never actually fetch anything, so
    // every card stayed at zero no matter which date range was picked. The
    // API now aggregates across every shop in the org when shopId is omitted,
    // so this case fetches too instead of short-circuiting.
    if (isAdmin && !currentShop) setShopName('Platform Analytics');

    const fetchAnalytics = async () => {
      try {
        const shopId = currentShop?.id;
        if (!shopId && !isAdmin) { setLoading(false); return; }

        const url = shopId
          ? `/api/portal/analytics?shopId=${shopId}&range=${dateRange}`
          : `/api/portal/analytics?range=${dateRange}`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            const { salesData: rawSalesData, topProducts: rawTopProducts, summary: rawSummary } = data.data;

            const processedSalesData: SalesData[] = (rawSalesData || []).map((item: RawSalesItem) => {
              const transactionCount = item.transactions || 1;
              return {
                date: item.date,
                sales: item.sales || 0,
                transactions: transactionCount,
                profit: item.profit || 0,
                avgTransactionValue: transactionCount > 0 ? item.sales / transactionCount : 0,
              };
            });

            const processedProducts: ProductAnalytics[] = (rawTopProducts || []).map((product: RawProductItem) => {
              const totalSales = product.sales || product.totalSales || 0;
              const margin = totalSales > 0 ? ((product.profit || 0) / totalSales) * 100 : 0;
              return {
                id: product.id || `product-${product.name}`,
                name: product.name || 'Unknown Product',
                quantity: product.quantity || 0,
                totalSales,
                profit: product.profit || 0,
                profitMargin: margin,
                costPrice: product.costPrice,
              };
            });

            setSalesData(processedSalesData);
            setTopProducts(processedProducts);
            setCanSeeProfit(rawSummary.totalProfit !== null && rawSummary.totalProfit !== undefined);

            const totalTransactions = rawSummary.totalTransactions || 0;
            const avgValue = totalTransactions > 0 ? rawSummary.totalSales / totalTransactions : 0;
            const bestDayProfit = Math.max(...processedSalesData.map((d: SalesData) => d.profit), 0);
            const worstDayProfit = Math.min(...processedSalesData.map((d: SalesData) => d.profit), 0);

            setSummary({
              totalSales: rawSummary.totalSales || 0,
              totalProfit: rawSummary.totalProfit || 0,
              avgMargin: rawSummary.avgMargin || 0,
              totalExpenses: rawSummary.totalExpenses || 0,
              netProfit: rawSummary.netProfit || 0,
              netMargin: rawSummary.netMargin || 0,
              totalTransactions,
              avgTransactionValue: avgValue,
              bestDay: bestDayProfit,
              worstDay: worstDayProfit,
            });

            if (currentShop?.name) setShopName(currentShop.name);
          }
        } else if (response.status === 401) {
          toast.error('Unauthorized - please login again');
        } else {
          toast.error('Failed to load analytics data');
        }
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
        toast.error('Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [mounted, currentShop, token, dateRange, authUser?.role, _hasHydrated]);

  // Inventory value — admin-only, fetched once per session rather than on
  // every dateRange/currentShop change (it's a snapshot, not scoped to
  // either — see the route's own doc comment).
  useEffect(() => {
    if (!mounted || !_hasHydrated || !token) return;
    const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';
    if (!isAdmin) { setInventoryLoading(false); return; }

    (async () => {
      setInventoryLoading(true);
      try {
        const response = await fetch('/api/portal/analytics/inventory', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await response.json();
        if (response.ok && data.success) {
          setInventory(data.data);
        }
      } catch (error) {
        console.error('Failed to fetch inventory value:', error);
      } finally {
        setInventoryLoading(false);
      }
    })();
  }, [mounted, _hasHydrated, token, authUser?.role]);

  // Monthly P&L trend (gross vs net profit). Independent of the week/month/year
  // range selector — always the last 6 calendar months — but respects the shop
  // filter so a single-shop view shows that shop's own P&L.
  useEffect(() => {
    if (!mounted || !_hasHydrated || !token) return;
    const admin = authUser?.role === 'admin' || authUser?.role === 'super_admin';
    const shopId = currentShop?.id;
    if (!shopId && !admin) { setPnl([]); return; }
    (async () => {
      try {
        const url = shopId
          ? `/api/portal/analytics/pnl?shopId=${shopId}&months=6`
          : `/api/portal/analytics/pnl?months=6`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const j = await res.json();
        if (res.ok && j.success && Array.isArray(j.data)) setPnl(j.data);
      } catch { /* leave empty */ }
    })();
  }, [mounted, _hasHydrated, token, currentShop, authUser?.role]);

  /* ---- derived ---- */
  const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';
  const filteredProducts = useMemo(() => {
    if (!searchTerm.trim()) return topProducts;
    return topProducts.filter(p =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [searchTerm, topProducts]);

  const chartData = useMemo(
    () =>
      salesData.map(item => ({
        date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        sales: Math.round(item.sales * reportRate),
        profit: Math.round(item.profit * reportRate),
        transactions: item.transactions,
        avgValue: Math.round(item.avgTransactionValue * reportRate),
      })),
    [salesData, reportRate],
  );

  const productChartData = useMemo(
    () =>
      topProducts.slice(0, 5).map(p => ({
        id: p.id,
        name: p.name.length > 15 ? p.name.substring(0, 14) + '…' : p.name,
        sales: Math.round(p.totalSales),
        profit: Math.round(p.profit),
        quantity: p.quantity,
        margin: p.profitMargin.toFixed(1),
      })),
    [topProducts],
  );

  const productPieData = useMemo(
    () =>
      topProducts.slice(0, 5).map(p => ({
        name: p.name.length > 12 ? p.name.substring(0, 11) + '…' : p.name,
        fullName: p.name, // the legend has room for the whole name (and truncates by CSS if not)
        value: Math.round(p.totalSales),
        id: p.id,
      })),
    [topProducts],
  );

  const marginPercent =
    summary.totalSales > 0 ? ((summary.totalProfit / summary.totalSales) * 100) : 0;

  // P&L trend chart (gross vs net profit + expenses per month), converted to
  // the reporting currency.
  const pnlChartData = useMemo(
    () =>
      pnl.map(m => ({
        month: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        gross: Math.round(m.grossProfit * reportRate),
        net: Math.round(m.netProfit * reportRate),
        expenses: Math.round(m.expenses * reportRate),
      })),
    [pnl, reportRate],
  );

  // Month-over-month change in net profit (latest full month vs the one before).
  const netMoM = useMemo(() => {
    if (pnl.length < 2) return null;
    const curr = pnl[pnl.length - 1].netProfit;
    const prev = pnl[pnl.length - 2].netProfit;
    if (prev === 0) return curr === 0 ? 0 : null; // undefined % when prior month was flat
    return ((curr - prev) / Math.abs(prev)) * 100;
  }, [pnl]);

  /* ---- loading / empty states ---- */
  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (authUser?.role === 'portal_user' && !currentShop) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400">Loading shop information...</p>
      </div>
    );
  }

  /* ---- render ---- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <PortalHeader
        backHref="/dashboard"
        title="Analytics"
        description={shopName}
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Analytics' }]}
        actions={
          <div className="flex items-center gap-2">
          {reportCurrencies.length > 1 && (
            <select
              value={reportingCurrency}
              onChange={(e) => setReportingCurrency(e.target.value)}
              title="Reporting currency"
              className="rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm"
            >
              {reportCurrencies.map((c) => <option key={c} value={c}>{c}{c === cur ? ' (base)' : ''}</option>)}
            </select>
          )}
          <div className="flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
            {DATE_RANGES.map(r => (
              <Button
                key={r.value}
                variant={dateRange === r.value ? 'default' : 'ghost'}
                onClick={() => setDateRange(r.value)}
                size="sm"
                className={
                  dateRange === r.value
                    ? ''
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }
              >
                <CalendarDays className="h-3.5 w-3.5 mr-1.5 hidden sm:inline-block" />
                {r.label}
              </Button>
            ))}
          </div>
          </div>
        }
      />

      <FeatureGate
        feature={FeatureCode.ADVANCED_ANALYTICS}
        requiredPlanLabel="Professional and higher"
        onUpgradeClick={() => { window.location.href = '/settings?tab=billing'; }}
      >
      <div className="px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">
        {/* ============================================ */}
        {/*  KPI CARDS                                   */}
        {/* ============================================ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            loading={loading}
            title="Total Sales"
            value={fmt(summary.totalSales)}
            subtitle={
              <span>
                {summary.totalTransactions} transactions •{' '}
                <TrendIndicator value={marginPercent} suffix="% margin" />
              </span>
            }
            icon={<ShoppingCart className="h-5 w-5 text-blue-600" />}
            iconBg="bg-blue-100 dark:bg-blue-900/50"
          />
          <KPICard
            loading={loading}
            title="Gross Profit"
            value={
              <span className="text-green-600 dark:text-green-400">
                {fmt(summary.totalProfit)}
              </span>
            }
            subtitle={`${marginPercent.toFixed(1)}% margin · before expenses`}
            icon={<DollarSign className="h-5 w-5 text-green-600" />}
            iconBg="bg-green-100 dark:bg-green-900/50"
          />
          {canSeeProfit && (
            <KPICard
              loading={loading}
              title="Expenses"
              value={
                <span className="text-rose-600 dark:text-rose-400">
                  {fmt(summary.totalExpenses)}
                </span>
              }
              subtitle="Operating expenses this period"
              icon={<Receipt className="h-5 w-5 text-rose-600" />}
              iconBg="bg-rose-100 dark:bg-rose-900/50"
            />
          )}
          {canSeeProfit && (
            <KPICard
              loading={loading}
              title="Net Profit"
              value={
                <span className={summary.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
                  {fmt(summary.netProfit)}
                </span>
              }
              subtitle={
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <span>{summary.netMargin.toFixed(1)}% margin · after expenses</span>
                  {netMoM != null && (
                    <span className="inline-flex items-center gap-1">
                      <span className="text-gray-400">MoM</span>
                      <TrendIndicator value={netMoM} />
                    </span>
                  )}
                </span>
              }
              icon={<Wallet className="h-5 w-5 text-emerald-600" />}
              iconBg="bg-emerald-100 dark:bg-emerald-900/50"
            />
          )}
          <KPICard
            loading={loading}
            title="Avg Margin"
            value={
              <span className="text-indigo-600 dark:text-indigo-400">
                {summary.avgMargin.toFixed(1)}%
              </span>
            }
            subtitle="Gross profit margin"
            icon={<TrendingUp className="h-5 w-5 text-indigo-600" />}
            iconBg="bg-indigo-100 dark:bg-indigo-900/50"
          />
          <KPICard
            loading={loading}
            title="Per Transaction"
            value={fmt(summary.avgTransactionValue)}
            subtitle="Average sale value"
            icon={<Activity className="h-5 w-5 text-purple-600" />}
            iconBg="bg-purple-100 dark:bg-purple-900/50"
          />
        </div>

        {/* ============================================ */}
        {/*  INVENTORY VALUE — admins only, org-wide,     */}
        {/*  independent of the date range / shop filter  */}
        {/* ============================================ */}
        {isAdmin && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <div>
                  <CardTitle>Inventory</CardTitle>
                  <CardDescription>Stock on hand and its value, across every shop</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {inventoryLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <div key={i} className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
                  ))}
                </div>
              ) : !inventory || inventory.shops.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">No active shops with stock yet.</p>
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total items</p>
                      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{inventory.totalUnits.toLocaleString('en-KE')}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">units across all shops</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Total value</p>
                      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{fmt(inventory.totalRetailValue)}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        at selling price{inventory.totalCostValue != null ? ` · ${fmt(inventory.totalCostValue)} at cost` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">By shop</p>
                    {inventory.shops.map((shop, index) => {
                      const maxValue = Math.max(...inventory.shops.map(s => s.retailValue), 1);
                      const pct = inventory.totalRetailValue > 0 ? (shop.retailValue / inventory.totalRetailValue) * 100 : 0;
                      const color = CHART_COLORS[index % CHART_COLORS.length];
                      return (
                        <div key={shop.shopId}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="flex items-center gap-2 font-medium text-gray-900 dark:text-white truncate">
                              <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                              {shop.shopName}
                            </span>
                            <span className="font-semibold text-gray-900 dark:text-white">{fmt(shop.retailValue)}</span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 pl-[18px]">
                            {shop.units.toLocaleString('en-KE')} unit{shop.units === 1 ? '' : 's'}
                            {inventory.totalRetailValue > 0 ? ` · ${pct.toFixed(0)}% of value` : ''}
                          </p>
                          <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, (shop.retailValue / maxValue) * 100)}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ============================================ */}
        {/*  PROFIT & LOSS TREND (MoM)                   */}
        {/* ============================================ */}
        {pnlChartData.some(m => m.gross !== 0 || m.expenses !== 0) && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <CardTitle>Profit &amp; Loss Trend</CardTitle>
                  <CardDescription>
                    Gross profit, expenses and net profit per month — last 6 months
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={pnlChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis dataKey="month" stroke={axisStroke} fontSize={12} tickLine={false} />
                  <YAxis stroke={axisStroke} fontSize={12} tickLine={false} width={44} tickFormatter={compactTick} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatMoney(Number(value), reportingCurrency)} />
                  <Legend />
                  <Bar dataKey="gross" fill="#10b981" radius={[4, 4, 0, 0]} name={`Gross profit (${reportingCurrency})`} />
                  <Bar dataKey="expenses" fill="#f43f5e" radius={[4, 4, 0, 0]} name={`Expenses (${reportingCurrency})`} />
                  <Bar dataKey="net" fill="#6366f1" radius={[4, 4, 0, 0]} name={`Net profit (${reportingCurrency})`} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {/* ============================================ */}
        {/*  CHARTS                                      */}
        {/* ============================================ */}
        {!loading && chartData.length > 0 && (
          <>
            {/* Sales & Profit Trend */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <div>
                    <CardTitle>Sales &amp; Profit Trend</CardTitle>
                    <CardDescription>Revenue and profit over the selected period</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                    <XAxis dataKey="date" stroke={axisStroke} fontSize={12} tickLine={false} />
                    <YAxis stroke={axisStroke} fontSize={12} tickLine={false} width={44} tickFormatter={compactTick} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatMoney(Number(value) * reportRate, reportingCurrency)} />
                    <Legend />
                    <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#gradSales)" name={`Sales (${reportingCurrency})`} />
                    <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#gradProfit)" name={`Profit (${reportingCurrency})`} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Transaction Volume + Avg Value side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Transactions */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <CardTitle>Transaction Volume</CardTitle>
                      <CardDescription>Number of sales per day</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="date" stroke={axisStroke} fontSize={12} tickLine={false} />
                      <YAxis stroke={axisStroke} fontSize={12} tickLine={false} width={44} tickFormatter={compactTick} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="transactions" fill="#f59e0b" radius={[6, 6, 0, 0]} name="Transactions" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Avg Transaction Value */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                    <div>
                      <CardTitle>Avg Transaction Value</CardTitle>
                      <CardDescription>Average sale amount per day</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient id="gradAvg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="date" stroke={axisStroke} fontSize={12} tickLine={false} />
                      <YAxis stroke={axisStroke} fontSize={12} tickLine={false} width={44} tickFormatter={compactTick} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatMoney(Number(value) * reportRate, reportingCurrency)} />
                      <Area type="monotone" dataKey="avgValue" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#gradAvg)" name={`Avg Value (${reportingCurrency})`} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* ============================================ */}
        {/*  PRODUCT ANALYSIS                            */}
        {/* ============================================ */}
        {!loading && topProducts.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Pie — Sales Contribution */}
            {productPieData.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <PieChartIcon className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                    <div>
                      <CardTitle>Sales Contribution</CardTitle>
                      <CardDescription>Top 5 products by revenue</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={productPieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        outerRadius={90}
                        innerRadius={45}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {productPieData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatMoney(Number(value) * reportRate, reportingCurrency)} />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Legend below the chart: outside slice labels ran off narrow screens and ignored the reporting currency. */}
                  {(() => {
                    const total = productPieData.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
                    return (
                      <ul className="mt-3 space-y-1.5 text-sm">
                        {productPieData.map((d, i) => (
                          <li key={d.id} className="flex items-start gap-2">
                            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate" title={d.fullName}>{d.fullName}</div>
                              <div className="text-xs text-gray-500">
                                <span className="font-medium text-gray-700 dark:text-gray-300">{formatMoney(Number(d.value) * reportRate, reportingCurrency)}</span>
                                {' · '}{total > 0 ? Math.round((Number(d.value) / total) * 100) : 0}%
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Bar — Product Performance */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                  <div>
                    <CardTitle>Product Performance</CardTitle>
                    <CardDescription>Sales vs profit for top products</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {productChartData.length > 0 && (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={productChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="name" stroke={axisStroke} fontSize={12} tickLine={false} />
                      <YAxis stroke={axisStroke} fontSize={12} tickLine={false} width={44} tickFormatter={compactTick} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => formatMoney(Number(value) * reportRate, reportingCurrency)} />
                      <Legend />
                      <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} name={`Sales (${reportingCurrency})`} />
                      <Bar dataKey="profit" fill="#10b981" radius={[4, 4, 0, 0]} name={`Profit (${reportingCurrency})`} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ============================================ */}
        {/*  TOP SELLING PRODUCTS TABLE                  */}
        {/* ============================================ */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                <div>
                  <CardTitle>Top Selling Products</CardTitle>
                  <CardDescription>Ranked by total sales volume</CardDescription>
                </div>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search products..."
                  className="pl-9"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 animate-pulse">
                    <div className="h-8 w-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-40 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
                    </div>
                    <div className="h-5 w-20 rounded bg-gray-200 dark:bg-gray-700" />
                  </div>
                ))}
              </div>
            ) : filteredProducts.length > 0 ? (
              <div className="space-y-2">
                {filteredProducts.map((product, index) => {
                  const rank = topProducts.indexOf(product) + 1;
                  const maxMargin = Math.max(...topProducts.map(p => p.profitMargin), 1);
                  const barWidth = (product.profitMargin / maxMargin) * 100;
                  return (
                    <div
                      key={product.id}
                      className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group"
                    >
                      {/* Rank */}
                      <div
                        className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-full text-xs font-bold ${
                          rank === 1
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                            : rank === 2
                              ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                              : rank === 3
                                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                        }`}
                      >
                        {rank}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 dark:text-white line-clamp-2 break-words">
                          {product.name}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {product.quantity} units
                          </span>
                          {/* margin bar */}
                          <div className="hidden sm:flex items-center gap-2 flex-1 max-w-[180px]">
                            <div className="h-1.5 flex-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-green-500 dark:bg-green-400 transition-all"
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
                              {product.profitMargin.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Financials */}
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-gray-900 dark:text-white">
                          {fmt(product.profit)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          of {fmt(product.totalSales)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <Search className="h-10 w-10 mx-auto text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400 font-medium">No products found</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                  Try a different search term
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Empty state when no data at all */}
        {!loading && chartData.length === 0 && topProducts.length === 0 && (
          <Card>
            <CardContent className="py-16">
              <div className="text-center">
                <BarChart3 className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">No analytics data yet</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
                  Sales data will appear here once transactions are recorded for the selected time period.
                  Try changing the date range or check back later.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      </FeatureGate>
    </div>
  );
}

