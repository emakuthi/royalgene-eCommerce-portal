'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import PortalHeader from '@/components/portal/PortalHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useHydratedAuth } from '@/lib/hooks';
import { useTheme } from '@/lib/theme-context';

interface DeletedProduct {
  id: string;
  name: string | null;
  sku: string | null;
  deletedAt: string;
  deletedBy: string | null;
  shops: Array<{ shopId: string; shopName: string | null; quantity: number; movements: number }>;
}

export default function DeletedProductsPage() {
  const { theme } = useTheme();
  const { token, user: authUser } = useHydratedAuth();
  const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';

  const bgPrimary = theme === 'dark' ? 'bg-black' : 'bg-gray-50';
  const textPrimary = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';

  const [mounted, setMounted] = useState(false);
  const [products, setProducts] = useState<DeletedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<DeletedProduct | null>(null);
  const [purging, setPurging] = useState(false);

  useEffect(() => setMounted(true), []);

  const fetchDeleted = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/portal/products/deleted', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.success) {
        setProducts(json.data.products || []);
      } else {
        toast.error(json.error || 'Failed to load deleted products');
      }
    } catch (err) {
      console.error('Failed to fetch deleted products', err);
      toast.error('Failed to load deleted products');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (mounted) void fetchDeleted(); }, [mounted, fetchDeleted]);

  const restore = async (id: string) => {
    setRestoringId(id);
    try {
      const res = await fetch('/api/portal/products/deleted/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        toast.error(json.error || 'Failed to restore product');
        return;
      }
      toast.success(json.message || 'Product restored');
      void fetchDeleted();
    } catch (err) {
      console.error('Restore product error', err);
      toast.error('Failed to restore product');
    } finally {
      setRestoringId(null);
    }
  };

  const purge = async () => {
    if (!purgeTarget) return;
    setPurging(true);
    try {
      const res = await fetch('/api/portal/products/deleted/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ id: purgeTarget.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        toast.error(json.error || 'Failed to delete product');
        return;
      }
      toast.success(json.message || 'Permanently deleted');
      setPurgeTarget(null);
      void fetchDeleted();
    } catch (err) {
      console.error('Purge product error', err);
      toast.error('Failed to delete product');
    } finally {
      setPurging(false);
    }
  };

  if (!mounted) return null;

  if (!isAdmin) {
    return (
      <div className={`${bgPrimary} w-full min-h-screen flex items-center justify-center`}>
        <p className={textSecondary}>Only workspace admins can view deleted products.</p>
      </div>
    );
  }

  return (
    <div className={`${bgPrimary} w-full`}>
      <PortalHeader
        backHref="/stock"
        title="Deleted Products"
        description="Bring a deleted product back with its stock, sizes and colours, and history"
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Stock', href: '/stock' }, { label: 'Deleted Products' }]}
      />

      <div className="px-2 sm:px-2 pb-6 w-full pt-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArchiveRestore className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <div>
                <CardTitle>Deleted Products</CardTitle>
                <CardDescription>Stock returns at the quantity it had when it was deleted, so check it against the shelf afterwards</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className={`text-center py-12 ${textSecondary}`}>
                <ArchiveRestore className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">No deleted products.</p>
              </div>
            ) : (
              <ul className={`divide-y ${theme === 'dark' ? 'divide-gray-800' : 'divide-gray-100'}`}>
                {products.map((p) => (
                  <li key={p.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className={`text-sm font-medium ${textPrimary}`}>
                        {p.name || 'Unknown product'}{p.sku ? ` · ${p.sku}` : ''}
                      </div>
                      <div className={`text-xs ${textSecondary}`}>
                        Deleted {new Date(p.deletedAt).toLocaleString()}{p.deletedBy ? ` by ${p.deletedBy}` : ''}
                      </div>
                      {p.shops.length > 0 ? (
                        p.shops.map((s) => (
                          <div key={s.shopId} className={`text-xs ${textSecondary}`}>
                            {s.shopName || 'Closed shop'}: {s.quantity} in stock, {s.movements} stock {s.movements === 1 ? 'movement' : 'movements'}
                          </div>
                        ))
                      ) : (
                        <div className={`text-xs ${textSecondary}`}>
                          Deleted before stock was being saved, so it can’t be restored here.
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0 self-start sm:self-center">
                      {p.shops.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => void restore(p.id)}
                          disabled={restoringId === p.id}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          {restoringId === p.id ? 'Restoring…' : 'Restore'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 text-red-600 hover:text-red-700 dark:text-red-400"
                        onClick={() => setPurgeTarget(p)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete permanently
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(purgeTarget)} onOpenChange={(open) => !open && !purging && setPurgeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {purgeTarget?.name || 'this product'}?</DialogTitle>
            <DialogDescription>
              It leaves Deleted Products for good and can’t be restored. Its sales, orders and transfers stay in your history with its name.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 pt-2">
            <Button className="flex-1 bg-red-600 hover:bg-red-700 text-white" disabled={purging} onClick={() => void purge()}>
              {purging ? 'Deleting…' : 'Delete permanently'}
            </Button>
            <Button variant="outline" type="button" disabled={purging} onClick={() => setPurgeTarget(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
