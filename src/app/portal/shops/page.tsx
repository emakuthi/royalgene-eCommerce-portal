'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Plus, MapPin, Phone, Mail, User, Eye, Edit, Settings, Store, Users, TrendingUp } from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';
import { useHydratedAuth } from '@/lib/hooks';
import { toast } from 'sonner';
import { getShops } from '@/lib/shops';
import StatCard from '@/components/ui/stat-card';
import { formatKESMajor } from '@/lib/format';

interface Shop {
  id: string;
  name: string;
  location: string;
  phone?: string;
  email?: string;
  shopkeeper?: string | null;
  createdAt?: string;
}

// Fallback sample data (used only if fetch fails) - module scope to avoid useEffect dependency
const sampleShops: Shop[] = [
  { id: 'shop1', name: 'Main Store', location: '123 Fashion Street, Downtown', phone: '+1-234-567-8901', email: 'main@boutique.com', shopkeeper: 'Shop Keeper', createdAt: 'Jan 15, 2024, 03:00 AM' },
  { id: 'shop2', name: 'Downtown Branch', location: '456 Style Avenue, City Center', phone: '+1-234-567-8902', email: 'downtown@boutique.com', shopkeeper: 'Alice Johnson', createdAt: 'Feb 20, 2024, 03:00 AM' },
  { id: 'shop3', name: 'Mall Outlet', location: '789 Shopping Mall, Level 2', phone: '+1-234-567-8903', email: 'mall@boutique.com', shopkeeper: null, createdAt: 'Mar 10, 2024, 03:00 AM' },
];

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

  // sampleShops is a stable module-level constant; avoid noisy linter here
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
          toast.error(res.error || 'Failed to load shops from server — showing sample data');
          setShops(sampleShops);
        }
      } catch (err) {
        console.error('Error loading shops', err);
        toast.error('Error loading shops — showing sample data');
        setShops(sampleShops);
      } finally {
        setLoading(false);
      }
    };

    // call loader and intentionally ignore returned promise (use void to satisfy lint rules)
    void load();
  }, [mounted, token]);

  // createShop moved to dedicated page; keep shops listing code here only

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
    return (
      <>
        <PortalHeader
          backHref="/portal/dashboard"
          title="Shop Management"
          description="Create and manage outlets, assign shopkeepers, and monitor performance"
          breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Shops' }]}
          actions={(
            <div className="flex items-center gap-2">
              <Link href="/portal/shops/add-new">
                <Button className="bg-[hsl(var(--primary))] bg-opacity-10 text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary))] hover:bg-opacity-20"><Plus className="mr-2" />Create Shop</Button>
              </Link>

              {/* Quick add actions to other portals */}
              <Link href="/portal/sales/new">
                <Button variant="outline">New Sale</Button>
              </Link>
              <Link href="/portal/stock/add-new">
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
            <StatCard title="Total Revenue" value={formatKESMajor(12381.5)} subtitle="All outlets combined" icon={<span className="text-green-600">KES</span>} />
            <StatCard title="Avg Performance" value="85%" subtitle="Target achievement" icon={<TrendingUp className="h-6 w-6 text-blue-600" />} />
          </div>
          {/* Tabs */}
          <div className="flex items-center gap-2 mb-4">
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
                      <div className="overflow-x-auto">
                        {loading ? (
                          <div className="py-12 text-center text-gray-600">Loading shops...</div>
                        ) : (
                          <table className="w-full min-w-[800px] table-auto">
                            <thead>
                              <tr className="text-left text-sm text-muted-foreground">
                                <th className="py-3 px-4">Shop Details</th>
                                <th className="py-3 px-4">Location</th>
                                <th className="py-3 px-4">Contact</th>
                                <th className="py-3 px-4">Shopkeeper</th>
                                <th className="py-3 px-4">Status</th>
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
                                      <Button size="sm" variant="outline">Assign</Button>
                                    )}
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[hsl(var(--primary))] bg-opacity-10 text-[hsl(var(--primary-foreground))]">Active</span>
                                  </td>
                                  <td className="py-4 px-4 text-sm text-muted-foreground">{shop.createdAt}</td>
                                  <td className="py-4 px-4">
                                    <div className="flex items-center gap-3">
                                      <Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button>
                                      <Link href={`/portal/shops/${shop.id}/edit`}>
                                        <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                                      </Link>
                                      <Button variant="ghost" size="icon"><Settings className="h-4 w-4" /></Button>
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
              <div className="space-y-4">
                <div className="pt-4 grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <StatCard title="Sales (7d)" value={formatKESMajor(45230.0)} subtitle="Last 7 days" icon={<TrendingUp className="h-6 w-6 text-green-600" />} />
                  <StatCard title="Orders" value={128} subtitle="Last 7 days" icon={<Users className="h-6 w-6 text-blue-600" />} />
                  <StatCard title="Conversion" value="3.2%" subtitle="Store avg" icon={<Store className="h-6 w-6 text-purple-600" />} />
                </div>
                <Card>
                  <CardContent>
                    <div className="text-sm text-muted-foreground">Performance analytics are coming soon. Integrate metrics and charts here (revenue by outlet, orders by day, top products).</div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === 'management' && (
              <div className="space-y-4">
                <Card>
                  <CardContent>
                    <div className="text-sm">
                      <div className="font-medium mb-2">Management</div>
                      <p className="text-muted-foreground">Use the actions to assign shopkeepers, configure outlets, or sync inventory. Quick links:</p>
                      <div className="mt-3 flex gap-2">
                        <Link href="/portal/stock"><Button variant="outline">View Products</Button></Link>
                        <Link href="/portal/sales"><Button variant="outline">View Sales</Button></Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  return <ShopsPageInner />;
}

// Note: keep previous default export shape consistent
