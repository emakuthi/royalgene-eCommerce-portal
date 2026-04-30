'use client';

import { useEffect, useState, useCallback } from 'react';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { useTheme } from '@/lib/theme-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import PortalHeader from '@/components/portal/PortalHeader';
import StatCard from '@/components/ui/stat-card';
import { toast } from 'sonner';
import {
  Activity, RefreshCw, ChevronLeft, ChevronRight,
  Monitor, Smartphone, Tablet, Globe, Clock,
  ShieldCheck, ShieldAlert,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface ActivityLog {
  id: string;
  action: string;
  category: string;
  source: string;
  endpoint?: string;
  resourceType?: string;
  resourceId?: string;
  shopId?: string;
  deviceType?: string;
  status: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const CATEGORY_COLORS: Record<string, string> = {
  auth:     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  product:  'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  sale:     'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  stock:    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  order:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  admin:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  settings: 'bg-gray-100 text-gray-700 dark:bg-gray-700/40 dark:text-gray-300',
  shop:     'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  payment:  'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  general:  'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-400',
};

const STATUS_DOT: Record<string, string> = {
  success: 'bg-green-500',
  failure: 'bg-red-500',
  denied:  'bg-yellow-500',
};

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <Monitor className="h-4 w-4" />,
  mobile:  <Smartphone className="h-4 w-4" />,
  tablet:  <Tablet className="h-4 w-4" />,
  api:     <Globe className="h-4 w-4" />,
};

const CATEGORY_TABS = ['', 'auth', 'product', 'sale', 'stock', 'order', 'settings'] as const;
const CATEGORY_LABELS: Record<string, string> = {
  '': 'All', auth: 'Auth', product: 'Products', sale: 'Sales',
  stock: 'Stock', order: 'Orders', settings: 'Settings',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function friendlyAction(action: string): string {
  const map: Record<string, string> = {
    'auth.login':         'Logged in',
    'auth.login_failed':  'Failed login attempt',
    'product.create':     'Created a product',
    'product.update':     'Updated a product',
    'product.delete':     'Deleted a product',
    'sale.record':        'Recorded a sale',
    'stock.update':       'Updated stock',
    'order.create':       'Created an order',
    'settings.update':    'Updated settings',
    'activity_logs.view': 'Viewed activity logs',
  };
  return map[action] || action.replace(/\./g, ' › ');
}

function relativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function fullDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

/* ------------------------------------------------------------------ */
/*  Page Content                                                       */
/* ------------------------------------------------------------------ */
function ActivityContent() {
  const { token } = useHydratedAuth();
  const { currentShop, _hasHydrated } = usePortalStore();
  const { theme } = useTheme();

  const [mounted, setMounted] = useState(false);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');

  const textPrimary   = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-400' : 'text-gray-500';
  const borderColor   = theme === 'dark' ? 'border-gray-800' : 'border-gray-200';
  const bgPage        = theme === 'dark' ? 'bg-black' : 'bg-gray-50';

  useEffect(() => { setMounted(true); }, []);

  const fetchLogs = useCallback(async (page = 1) => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (filterCategory) params.set('category', filterCategory);

      const res = await fetch(`/api/mobile/activity?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json();
      if (json.success) {
        setLogs(json.data.logs);
        setPagination(json.data.pagination);
      } else {
        toast.error(json.error || 'Failed to fetch activity');
      }
    } catch {
      toast.error('Failed to fetch activity');
    } finally {
      setLoading(false);
    }
  }, [token, filterCategory]);

  useEffect(() => {
    if (mounted && token && _hasHydrated) void fetchLogs(1);
  }, [mounted, token, _hasHydrated, fetchLogs]);

  /* ---- Derived stats ---- */
  const todayCount   = logs.filter(l => new Date(l.createdAt).toDateString() === new Date().toDateString()).length;
  const successCount = logs.filter(l => l.status === 'success').length;
  const failCount    = logs.filter(l => l.status === 'failure').length;

  /* ---- Loading state ---- */
  if (!mounted) {
    return (
      <div className={`flex items-center justify-center h-full ${bgPage}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className={textSecondary}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${bgPage} w-full`}>
      {/* ── Portal Header (sticky, same as other pages) ── */}
      <PortalHeader
        backHref="/portal/dashboard"
        title="Activity"
        description={currentShop ? `Activity log for ${currentShop.name}` : 'Your recent actions and history'}
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Activity' }]}
        actions={
          <Button variant="outline" onClick={() => fetchLogs(pagination.page)} disabled={loading} className={`flex items-center gap-2 ${textPrimary}`}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline text-sm">Refresh</span>
          </Button>
        }
      />

      {/* ── Content ── */}
      <div className="px-2 sm:px-2 py-2 pb-2 w-full">

        {/* ── KPI Cards (same grid as Sales page) ── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <StatCard
            title="Total Activities"
            value={pagination.total}
            subtitle="All recorded events"
            icon={<Activity className="h-6 w-6 text-blue-600" />}
            loading={loading}
          />
          <StatCard
            title="Today"
            value={todayCount}
            subtitle="Events today"
            icon={<Clock className="h-6 w-6 text-indigo-600" />}
            loading={loading}
          />
          <StatCard
            title="Successful"
            value={successCount}
            subtitle="On current page"
            icon={<ShieldCheck className="h-6 w-6 text-green-600" />}
            loading={loading}
          />
          <StatCard
            title="Failed"
            value={failCount}
            subtitle="On current page"
            icon={<ShieldAlert className="h-6 w-6 text-red-600" />}
            loading={loading}
          />
        </div>
      </div>

      <div className="px-2 sm:px-2 pb-6 w-full space-y-4">
        {/* ── Category Filter Tabs ── */}
        <div className="flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 overflow-x-auto">
          {CATEGORY_TABS.map(c => (
            <Button
              key={c}
              variant={filterCategory === c ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setFilterCategory(c)}
              className={filterCategory === c
                ? ''
                : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }
            >
              {CATEGORY_LABELS[c]}
            </Button>
          ))}
        </div>

        {/* ── Activity Feed Card ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <div>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Your actions across all channels</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              /* Skeleton rows (matches analytics / sales skeleton) */
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50 animate-pulse">
                    <div className="h-3 w-3 rounded-full bg-gray-200 dark:bg-gray-700" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-48 rounded bg-gray-200 dark:bg-gray-700" />
                      <div className="h-3 w-24 rounded bg-gray-200 dark:bg-gray-700" />
                    </div>
                    <div className="h-3 w-16 rounded bg-gray-200 dark:bg-gray-700" />
                  </div>
                ))}
              </div>
            ) : logs.length === 0 ? (
              /* Empty state (matches analytics empty) */
              <div className="text-center py-16">
                <Activity className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
                <h3 className={`text-lg font-semibold ${textPrimary}`}>No activity yet</h3>
                <p className={`text-sm mt-2 max-w-md mx-auto ${textSecondary}`}>
                  Your actions will appear here as you interact with the portal — creating products, recording sales, updating stock, and more.
                </p>
              </div>
            ) : (
              /* Activity rows */
              <div className="space-y-1">
                {logs.map((log, idx) => (
                  <div
                    key={log.id}
                    className={`flex items-start gap-4 px-4 py-3.5 rounded-xl transition-colors
                      ${idx % 2 === 0 ? 'bg-gray-50 dark:bg-gray-800/30' : ''}
                      hover:bg-gray-100 dark:hover:bg-gray-800/60`}
                  >
                    {/* Status dot */}
                    <div className="mt-1.5 flex-shrink-0">
                      <div className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[log.status] || 'bg-gray-400'}`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${textPrimary}`}>
                          {friendlyAction(log.action)}
                        </span>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${CATEGORY_COLORS[log.category] || CATEGORY_COLORS.general}`}>
                          {log.category}
                        </span>
                        {log.source !== 'portal' && (
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] ${theme === 'dark' ? 'bg-white/10 text-gray-400' : 'bg-gray-200 text-gray-500'}`}>
                            {log.source}
                          </span>
                        )}
                      </div>
                      {log.resourceType && (
                        <p className={`text-xs mt-0.5 ${textSecondary}`}>
                          {log.resourceType}
                          {log.resourceId ? ` · ${log.resourceId.slice(0, 8)}…` : ''}
                        </p>
                      )}
                    </div>

                    {/* Meta (device + time) */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {log.deviceType && (
                        <span className={textSecondary}>{DEVICE_ICONS[log.deviceType]}</span>
                      )}
                      <span className={`text-xs whitespace-nowrap ${textSecondary}`} title={fullDate(log.createdAt)}>
                        {relativeTime(log.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination (matches sales page pattern) */}
            {!loading && pagination.totalPages > 1 && (
              <div className={`mt-6 flex items-center justify-between border-t ${borderColor} pt-4`}>
                <div className={`text-sm ${textSecondary}`}>
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={() => fetchLogs(pagination.page - 1)} disabled={pagination.page <= 1} variant="outline" size="sm">Prev</Button>
                  <Button onClick={() => fetchLogs(pagination.page + 1)} disabled={!pagination.hasMore} variant="outline" size="sm">Next</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function PortalActivityPage() {
  return <ActivityContent />;
}
