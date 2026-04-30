'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useHydratedAuth } from '@/lib/hooks';
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

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const DATE_RANGES = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */
function formatCurrency(amount: number) {
  return (amount / 100).toLocaleString('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
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
    totalTransactions: 0,
    avgTransactionValue: 0,
    bestDay: 0,
    worstDay: 0,
  });

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

    if ((authUser?.role === 'admin' || authUser?.role === 'super_admin') && !currentShop) {
      setShopName('Platform Analytics');
      setLoading(false);
      return;
    }

    const fetchAnalytics = async () => {
      try {
        const shopId = currentShop?.id;
        if (!shopId) { setLoading(false); return; }

        const url = `/api/portal/analytics?shopId=${shopId}&range=${dateRange}`;
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

            const totalTransactions = rawSummary.totalTransactions || 0;
            const avgValue = totalTransactions > 0 ? rawSummary.totalSales / totalTransactions : 0;
            const bestDayProfit = Math.max(...processedSalesData.map((d: SalesData) => d.profit), 0);
            const worstDayProfit = Math.min(...processedSalesData.map((d: SalesData) => d.profit), 0);

            setSummary({
              totalSales: rawSummary.totalSales || 0,
              totalProfit: rawSummary.totalProfit || 0,
              avgMargin: rawSummary.avgMargin || 0,
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

  /* ---- derived ---- */
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
        sales: Math.round(item.sales / 100),
        profit: Math.round(item.profit / 100),
        transactions: item.transactions,
        avgValue: Math.round(item.avgTransactionValue / 100),
      })),
    [salesData],
  );

  const productChartData = useMemo(
    () =>
      topProducts.slice(0, 5).map(p => ({
        id: p.id,
        name: p.name.length > 15 ? p.name.substring(0, 14) + '…' : p.name,
        sales: Math.round(p.totalSales / 100),
        profit: Math.round(p.profit / 100),
        quantity: p.quantity,
        margin: p.profitMargin.toFixed(1),
      })),
    [topProducts],
  );

  const productPieData = useMemo(
    () =>
      topProducts.slice(0, 5).map(p => ({
        name: p.name.length > 12 ? p.name.substring(0, 11) + '…' : p.name,
        value: Math.round(p.totalSales / 100),
        id: p.id,
      })),
    [topProducts],
  );

  const marginPercent =
    summary.totalSales > 0 ? ((summary.totalProfit / summary.totalSales) * 100) : 0;

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
        }
      />

      <div className="px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">
        {/* ============================================ */}
        {/*  KPI CARDS                                   */}
        {/* ============================================ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            loading={loading}
            title="Total Sales"
            value={formatCurrency(summary.totalSales)}
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
            title="Total Profit"
            value={
              <span className="text-green-600 dark:text-green-400">
                {formatCurrency(summary.totalProfit)}
              </span>
            }
            subtitle={`${marginPercent.toFixed(1)}% of sales`}
            icon={<DollarSign className="h-5 w-5 text-green-600" />}
            iconBg="bg-green-100 dark:bg-green-900/50"
          />
          <KPICard
            loading={loading}
            title="Avg Margin"
            value={
              <span className="text-indigo-600 dark:text-indigo-400">
                {summary.avgMargin.toFixed(1)}%
              </span>
            }
            subtitle="Profit margin"
            icon={<TrendingUp className="h-5 w-5 text-indigo-600" />}
            iconBg="bg-indigo-100 dark:bg-indigo-900/50"
          />
          <KPICard
            loading={loading}
            title="Per Transaction"
            value={formatCurrency(summary.avgTransactionValue)}
            subtitle="Average sale value"
            icon={<Activity className="h-5 w-5 text-purple-600" />}
            iconBg="bg-purple-100 dark:bg-purple-900/50"
          />
        </div>

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
                    <YAxis stroke={axisStroke} fontSize={12} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => `KES ${Number(value).toLocaleString()}`} />
                    <Legend />
                    <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#gradSales)" name="Sales (KES)" />
                    <Area type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#gradProfit)" name="Profit (KES)" />
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
                      <YAxis stroke={axisStroke} fontSize={12} tickLine={false} />
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
                      <YAxis stroke={axisStroke} fontSize={12} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => `KES ${Number(value).toLocaleString()}`} />
                      <Area type="monotone" dataKey="avgValue" stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#gradAvg)" name="Avg Value (KES)" />
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
                <CardContent className="flex justify-center">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={productPieData}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, value }) => `${name}: ${value}`}
                        outerRadius={90}
                        innerRadius={45}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {productPieData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => `KES ${Number(value).toLocaleString()}`} />
                    </PieChart>
                  </ResponsiveContainer>
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
                      <YAxis stroke={axisStroke} fontSize={12} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => `KES ${Number(value).toLocaleString()}`} />
                      <Legend />
                      <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Sales (KES)" />
                      <Bar dataKey="profit" fill="#10b981" radius={[4, 4, 0, 0]} name="Profit (KES)" />
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
                        <p className="font-medium text-gray-900 dark:text-white truncate">
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
                          {formatCurrency(product.profit)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          of {formatCurrency(product.totalSales)}
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
    </div>
  );
}

