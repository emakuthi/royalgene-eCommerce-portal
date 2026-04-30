'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useHydratedAuth } from '@/lib/hooks';
import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

type SaleRow = {
  id: string;
  createdAt: string;
  totalAmount: number;
  product?: { name?: string } | null;
  quantity?: number;
  paymentMethod?: string;
};

export default function RecentSales({ shopId, limit = 5 }: { shopId?: string; limit?: number }) {
  const { token, user, mounted } = useHydratedAuth();
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState<SaleRow[]>([]);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (!mounted) return;

    // portal_user must have a shopId — skip fetch and show empty state if missing
    if (!isAdmin && !shopId) {
      setLoading(false);
      setSales([]);
      return;
    }

    let canceled = false;
    const fetchRecent = async () => {
      setLoading(true);
      try {
        const qs = new URLSearchParams();
        if (shopId) qs.set('shopId', shopId);
        qs.set('limit', String(limit));
        const url = `/api/portal/sales?${qs.toString()}`;
        const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: 'no-store' });
        if (!res.ok) {
          setSales([]);
          return;
        }
        const j = await res.json();
        if (!canceled && j?.success && Array.isArray(j.data)) {
          setSales(j.data.slice(0, limit));
        }
      } catch (err) {
        console.error('Failed to load recent sales', err);
      } finally {
        if (!canceled) setLoading(false);
      }
    };

    fetchRecent();
    return () => { canceled = true; };
  }, [mounted, shopId, limit, token, isAdmin]);

  if (loading) {
    return (
      <Card>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: limit }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center justify-between p-3 border rounded bg-white/50 dark:bg-gray-800/50">
                <div className="h-4 bg-gray-200 rounded w-48 dark:bg-gray-700" />
                <div className="h-4 bg-gray-200 rounded w-20 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Recent Sales</h3>
          <Link href="/sales">
            <Button variant="outline" size="sm">View All</Button>
          </Link>
        </div>

        <div className="space-y-3">
          {sales.length === 0 && (
            <div className="text-sm text-gray-500">No recent sales.</div>
          )}

          {sales.map(s => (
            <div key={s.id} className="p-3 border rounded bg-white/50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{s.product?.name ?? 'Sale'}</div>
                  <div className="text-sm text-gray-500">{s.quantity ?? 1} × {`KES ${(s.totalAmount / 100).toFixed(2)}`}</div>
                  <div className="text-xs text-gray-400">{formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}</div>
                </div>
                <div className="text-sm font-semibold">KES {(s.totalAmount / 100).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
