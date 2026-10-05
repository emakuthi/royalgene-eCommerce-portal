'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, MapPin, Phone, Mail, User, Edit, Store, Users, TrendingUp, Trash2 } from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';
import { useHydratedAuth } from '@/lib/hooks';
import { toast } from 'sonner';
import { getShops } from '@/lib/shops';
import StatCard from '@/components/ui/stat-card';
import { formatMoneyMajor } from '@/lib/format';
import { useBranding } from '@/lib/branding-context';
import MuiDialog from '@mui/material/Dialog';
import MuiDialogTitle from '@mui/material/DialogTitle';
import MuiDialogContent from '@mui/material/DialogContent';
import MuiDialogContentText from '@mui/material/DialogContentText';
import MuiDialogActions from '@mui/material/DialogActions';
import MuiButton from '@mui/material/Button';

/** Real per-shop numbers from /api/portal/dashboard/stats (last 30 days). */
interface ShopStats {
  revenue: number;
  transactions: number;
  /** null when this role can't see cost/profit. */
  profit: number | null;
  lowStock: number;
}

interface Shop {
  id: string;
  name: string;
  location: string;
  phone?: string;
  email?: string;
  shopkeeper?: string | null;
  createdAt?: string;
}

export default function ShopsPage() {
  // shops will be loaded from the server
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  // URL-backed tab state for deep-linking
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = (searchParams?.get('tab') as 'overview' | 'performance' | 'management') || 'overview';
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'management'>(initialTab);
  const [tabVisible, setTabVisible] = useState(true);

  const { token, mounted } = useHydratedAuth();

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (shopId: string) => {
    setDeleting(shopId);
    try {
      const res = await fetch(`/api/portal/shops/${shopId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        toast.success('Shop deleted');
        setShops(prev => prev.filter(s => s.id !== shopId));
      } else {
        toast.error(json.error || 'Failed to delete shop');
      }
    } catch (err) {
      console.error('Error deleting shop', err);
      toast.error('Error deleting shop');
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  };

  useEffect(() => {
    if (!mounted) return;

    const load = async () => {
      setLoading(true);
      try {
        const res = await getShops<Shop>(token ?? undefined);
        if (res.ok && res.success) {
          setShops((res.data ?? []) as Shop[]);
        } else {
          console.warn('Failed to fetch shops', res.error);
          // Never substitute made-up shops — an owner could try to edit/delete them.
          toast.error(res.error || 'Failed to load shops');
          setShops([]);
        }
      } catch (err) {
        console.error('Error loading shops', err);
        toast.error('Error loading shops');
        setShops([]);
      } finally {
        setLoading(false);
      }
    };

    // call loader and intentionally ignore returned promise (use void to satisfy lint rules)
    void load();
  }, [mounted, token]);

  // Per-shop last-30-day stats. These cards/tabs used to show hardcoded numbers
  // (revenue 12,381.50, "85% performance", 128 orders, 3.2% conversion).
  const [shopStats, setShopStats] = useState<Record<string, ShopStats>>({});
  useEffect(() => {
    if (!token || shops.length === 0) return;
    let cancelled = false;
    void Promise.all(shops.map(async (shop) => {
      try {
        const res = await fetch(`/api/portal/dashboard/stats?shopId=${shop.id}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const j = await res.json();
        if (!res.ok || !j?.success) return null;
        const d = j.data as { salesThisMonth?: number; transactionsThisMonth?: number; totalProfit?: number | null; lowStockProducts?: number };
        return [shop.id, { revenue: d.salesThisMonth ?? 0, transactions: d.transactionsThisMonth ?? 0, profit: d.totalProfit ?? null, lowStock: d.lowStockProducts ?? 0 }] as const;
      } catch { return null; }
    })).then(rows => {
      if (cancelled) return;
      setShopStats(Object.fromEntries(rows.filter((r): r is NonNullable<typeof r> => r !== null)));
    });
    return () => { cancelled = true; };
  }, [shops, token]);
  const statsLoaded = Object.keys(shopStats).length > 0;
  const totals = Object.values(shopStats).reduce(
    (acc, st) => ({ revenue: acc.revenue + st.revenue, transactions: acc.transactions + st.transactions }),
    { revenue: 0, transactions: 0 },
  );
  const canSeeProfit = Object.values(shopStats).some(st => st.profit !== null);


  // Helper to change tab and persist selection in the URL without full navigation
  const selectTab = (tab: 'overview' | 'performance' | 'management') => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    // update URL param (preserve other params)
    try {
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('tab', tab);
      const q = params.toString();
      router.replace(`${pathname}${q ? `?${q}` : ''}`);
    } catch (err) {
      // fallback: push simple query
      router.replace(`${pathname}?tab=${tab}`);
    }
  };

  // Small animation trigger when changing tabs
  useEffect(() => {
    setTabVisible(false);
    const id = window.setTimeout(() => setTabVisible(true), 80);
    return () => window.clearTimeout(id);
  }, [activeTab]);

  function ShopsPageInner() {
    const cur = useBranding().branding.currency;
    return (
      <>
        <PortalHeader
          backHref="/dashboard"
          title="Shop Management"
          description="Create and manage outlets, assign shopkeepers, and monitor performance"
          breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Shops' }]}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/shops/add-new">
                <Button className="bg-[hsl(var(--primary))] bg-opacity-10 text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))] hover:bg-opacity-20"><Plus className="mr-2" />Create Shop</Button>
              </Link>

              {/* Quick add actions to other portals */}
              <Link href="/sales/new">
                <Button variant="outline">New Sale</Button>
              </Link>
              <Link href="/stock/add-new">
                <Button variant="outline">New Product</Button>
              </Link>
            </div>
          )}
        />

        {/* Tabs + Metrics: keep consistent padding with other containers */}
        <div className="px-4 sm:px-6">
          {/* Metrics cards (apply top padding to leave a little space) */}
          <div className="pt-4 grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <StatCard title="Total Shops" value={shops.length} subtitle="Active outlets" icon={<Store className="h-6 w-6 text-emerald-600" />} />
            <StatCard title="With Shopkeepers" value={shops.filter(s => s.shopkeeper).length} subtitle="Assigned managers" icon={<Users className="h-6 w-6 text-purple-600" />} />
            <StatCard title="Revenue (30d)" value={statsLoaded ? formatMoneyMajor(totals.revenue, cur) : '—'} subtitle="All outlets combined" icon={<span className="text-green-600 text-sm">{cur}</span>} />
            <StatCard title="Transactions (30d)" value={statsLoaded ? totals.transactions.toLocaleString() : '—'} subtitle="Checkouts, all outlets" icon={<TrendingUp className="h-6 w-6 text-blue-600" />} />
          </div>
          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button variant="ghost" onClick={() => selectTab('overview')} className={`${activeTab === 'overview' ? 'bg-[hsl(var(--primary))] bg-opacity-10 text-[hsl(var(--primary-foreground))] rounded-md shadow-sm' : ''}`}>Shop Overview</Button>
            <Button variant="ghost" onClick={() => selectTab('performance')} className={`${activeTab === 'performance' ? 'bg-[hsl(var(--primary))] bg-opacity-10 text-[hsl(var(--primary-foreground))] rounded-md shadow-sm' : ''}`}>Performance</Button>
            <Button variant="ghost" onClick={() => selectTab('management')} className={`${activeTab === 'management' ? 'bg-[hsl(var(--primary))] bg-opacity-10 text-[hsl(var(--primary-foreground))] rounded-md shadow-sm' : ''}`}>Management</Button>
          </div>
        </div>

        {/* Content area: switch based on active tab with a small animation */}
        <div className="px-4 sm:px-6">
          <div className={`transition-all duration-300 ${tabVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
            {activeTab === 'overview' && (
              // Overview: existing shops table
              <>
                {/* Shops table card */}
                <div>
                  <Card className="rounded-lg">
                    <CardHeader>
                      <CardTitle>All Shops</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {/* Phones: one card per shop instead of an 800px-wide table. */}
                      {!loading && (
                        <ul className="sm:hidden divide-y divide-muted-foreground/10">
                          {shops.map((shop) => (
                            <li key={shop.id} className="py-3 space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="font-medium">{shop.name}</div>
                                  <div className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{shop.location || '—'}</span></div>
                                </div>
                                <div className="flex shrink-0 items-center">
                                  <Link href={`/shops/${shop.id}/edit`}><Button variant="ghost" size="icon" aria-label="Edit shop"><Edit className="h-4 w-4" /></Button></Link>
                                  <Button variant="ghost" size="icon" aria-label="Delete shop" className="text-destructive hover:text-destructive" disabled={deleting === shop.id} onClick={() => setDeleteTarget({ id: shop.id, name: shop.name })}><Trash2 className="h-4 w-4" /></Button>
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                                {shop.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{shop.phone}</span>}
                                {shop.email && <span className="flex min-w-0 items-center gap-1"><Mail className="h-3 w-3 shrink-0" /><span className="truncate">{shop.email}</span></span>}
                              </div>
                              <div className="text-xs flex items-center gap-1">
                                <User className="h-3 w-3 text-green-600" />
                                {shop.shopkeeper ? shop.shopkeeper : <Link href="/users" className="text-[hsl(var(--primary))] underline">Assign a shopkeeper</Link>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className={`overflow-x-auto ${loading ? '' : 'hidden sm:block'}`}>
                        {loading ? (
                          <div className="py-12 text-center text-gray-600">Loading shops...</div>
                        ) : (
                          <table className="w-full min-w-[720px] table-auto">
                            <thead>
                              <tr className="text-left text-sm text-muted-foreground">
                                <th className="py-3 px-4">Shop Details</th>
                                <th className="py-3 px-4">Location</th>
                                <th className="py-3 px-4">Contact</th>
                                <th className="py-3 px-4">Shopkeeper</th>
                                <th className="py-3 px-4">Created</th>
                                <th className="py-3 px-4">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shops.map((shop) => (
                                <tr key={shop.id} className="border-t border-muted-foreground/10">
                                  <td className="py-4 px-4">
                                    <div className="flex items-center gap-3">
                                      <div className="p-2 rounded-full bg-[hsl(var(--primary))] bg-opacity-10 text-[hsl(var(--primary-foreground))]">
                                        <MapPin className="h-5 w-5" />
                                      </div>
                                      <div>
                                        <div className="font-medium">{shop.name}</div>
                                        <div className="text-xs text-muted-foreground">ID: {shop.id}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-sm text-muted-foreground">{shop.location}</td>
                                  <td className="py-4 px-4 text-sm text-muted-foreground">
                                    <div className="flex flex-col">
                                      <div className="flex items-center gap-2">
                                        <Phone className="h-4 w-4" />
                                        <span>{shop.phone || '-'}</span>
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        <Mail className="h-4 w-4" />
                                        <span>{shop.email || '-'}</span>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4 text-sm">
                                    {shop.shopkeeper ? (
                                      <div className="flex items-center gap-2">
                                        <User className="h-4 w-4 text-green-600" />
                                        <span>{shop.shopkeeper}</span>
                                      </div>
                                    ) : (
                                      // Shop assignment is managed per user on the Users page.
                                      <Link href="/users"><Button size="sm" variant="outline">Assign</Button></Link>
                                    )}
                                  </td>
                                  <td className="py-4 px-4 text-sm text-muted-foreground">{shop.createdAt ? new Date(shop.createdAt).toLocaleDateString() : '—'}</td>
                                  <td className="py-4 px-4">
                                    <div className="flex items-center gap-3">
                                      <Link href={`/shops/${shop.id}/edit`}>
                                        <Button variant="ghost" size="icon" aria-label="Edit shop"><Edit className="h-4 w-4" /></Button>
                                      </Link>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-destructive hover:text-destructive"
                                        disabled={deleting === shop.id}
                                        onClick={() => setDeleteTarget({ id: shop.id, name: shop.name })}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}

            {activeTab === 'performance' && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Performance by shop · last 30 days</CardTitle>
                </CardHeader>
                <CardContent>
                  {!statsLoaded ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">Loading shop performance…</div>
                  ) : (
                    <ul className="divide-y divide-muted-foreground/10">
                      {[...shops].sort((a, b) => (shopStats[b.id]?.revenue ?? 0) - (shopStats[a.id]?.revenue ?? 0)).map((shop) => {
                        const st = shopStats[shop.id];
                        const share = totals.revenue > 0 && st ? Math.round((st.revenue / totals.revenue) * 100) : 0;
                        return (
                          <li key={shop.id} className="py-3">
                            <div className="flex items-baseline justify-between gap-3">
                              <div className="min-w-0 font-medium truncate">{shop.name}</div>
                              <div className="shrink-0 whitespace-nowrap font-semibold">{st ? formatMoneyMajor(st.revenue, cur) : '—'}</div>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted">
                              <div className="h-1.5 rounded-full bg-[hsl(var(--primary))]" style={{ width: `${share}%` }} />
                            </div>
                            <div className="mt-1.5 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                              <span>{share}% of revenue</span>
                              <span>{(st?.transactions ?? 0).toLocaleString()} transactions</span>
                              {canSeeProfit && st?.profit != null && <span>Profit {formatMoneyMajor(st.profit, cur)}</span>}
                              <span className={st && st.lowStock > 0 ? 'text-amber-600' : ''}>{st?.lowStock ?? 0} low-stock items</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            {activeTab === 'management' && (
              <div className="space-y-4">
                <Card>
                  <CardContent>
                    <div className="text-sm">
                      <div className="font-medium mb-2">Management</div>
                      <p className="text-muted-foreground">Use the actions to assign shopkeepers, configure outlets, or sync inventory. Quick links:</p>
                      <div className="mt-3 flex gap-2">
                        <Link href="/stock"><Button variant="outline">View Products</Button></Link>
                        <Link href="/sales"><Button variant="outline">View Sales</Button></Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>

        {/* Delete Shop Confirmation Modal */}
        <MuiDialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
          <MuiDialogTitle sx={{ fontWeight: 700 }}>🗑️ Delete Shop</MuiDialogTitle>
          <MuiDialogContent>
            <MuiDialogContentText>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? Staff assigned to it will need to be reassigned, and it can only be restored from the database. Products and sales history are kept, not deleted.
            </MuiDialogContentText>
          </MuiDialogContent>
          <MuiDialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
            <MuiButton onClick={() => setDeleteTarget(null)} variant="outlined" size="small" disabled={Boolean(deleting)}>Cancel</MuiButton>
            <MuiButton onClick={() => deleteTarget && void handleDelete(deleteTarget.id)} variant="contained" size="small" disabled={Boolean(deleting)} sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>{deleting ? 'Deleting…' : 'Delete'}</MuiButton>
          </MuiDialogActions>
        </MuiDialog>
      </>
    );
  }

  return <ShopsPageInner />;
}

// Note: keep previous default export shape consistent
