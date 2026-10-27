'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Check, X, Undo2 } from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';
import { Button } from '@/components/ui/button';
import { useHydratedAuth } from '@/lib/hooks';

type Cell = { size: string; color: string; quantity: number };
type Transfer = {
  id: string;
  quantity: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'cancelled';
  variants: Cell[] | null;
  notes: string | null;
  rejectionReason: string | null;
  initiatedAt: string;
  resolvedAt: string | null;
  direction: 'incoming' | 'outgoing' | 'all';
  canApprove: boolean;
  canCancel: boolean;
  Product: { name: string; sku: string | null } | null;
  fromShop: { name: string } | null;
  toShop: { name: string } | null;
};

const STATUS_STYLE: Record<Transfer['status'], string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  rejected: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  cancelled: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};
const STATUS_LABEL: Record<Transfer['status'], string> = {
  pending: 'Awaiting approval', confirmed: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
};

const cellLabel = (c: Cell) => [c.size, c.color].filter(Boolean).join(' / ') || 'Default';

export default function TransfersPage() {
  const { token } = useHydratedAuth();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = tab === 'pending' ? '?status=pending' : '';
      const res = await fetch(`/api/portal/stock/transfer-requests${qs}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load transfers');
      setTransfers(json.data.transfers);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transfers');
    } finally {
      setLoading(false);
    }
  }, [token, tab]);

  useEffect(() => { void load(); }, [load]);

  async function act(t: Transfer, action: 'confirm' | 'reject' | 'cancel') {
    let body: string | undefined;
    if (action === 'reject') {
      const reason = window.prompt('Reason for rejecting (optional)');
      if (reason === null) return;
      body = JSON.stringify({ reason });
    }
    setBusyId(t.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/portal/stock/transfer-requests/${t.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body,
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Something went wrong');
      setNotice(json.message);
      setError(null);
      window.dispatchEvent(new Event('transfers:changed'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="w-full min-h-[60vh]">
      <PortalHeader
        backHref="/stock"
        title="Transfers"
        description="Stock sent between shops lands only after the receiving shop approves it."
        breadcrumbs={[{ label: 'Portal', href: '/dashboard' }, { label: 'Transfers' }]}
      />
      <div className="w-full px-4 sm:px-6 pb-10 space-y-4">
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-800">
          {(['pending', 'all'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-4 py-1.5 text-sm rounded-md ${tab === k ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-600 dark:text-gray-300'}`}
            >
              {k === 'pending' ? 'Awaiting approval' : 'All transfers'}
            </button>
          ))}
        </div>

        {notice && <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 px-4 py-3 text-sm">{notice}</div>}
        {error && <div className="rounded-lg bg-rose-50 dark:bg-rose-900/30 text-rose-800 dark:text-rose-200 px-4 py-3 text-sm">{error}</div>}

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : transfers.length === 0 ? (
          <p className="text-sm text-gray-500 py-8 text-center">
            {tab === 'pending' ? 'Nothing waiting for approval.' : 'No transfers yet.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {transfers.map((t) => (
              <li key={t.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-white truncate">
                      {t.Product?.name ?? 'Product'}{t.Product?.sku ? <span className="font-normal text-gray-500"> · {t.Product.sku}</span> : null}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1.5 flex-wrap">
                      {t.fromShop?.name ?? 'Shop'} <ArrowRight className="h-3.5 w-3.5" /> {t.toShop?.name ?? 'Shop'}
                      <span className="text-gray-400">· {new Date(t.initiatedAt).toLocaleString()}</span>
                    </p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                </div>

                <p className="mt-2 text-sm text-gray-800 dark:text-gray-200">
                  <span className="font-medium">{t.quantity} unit(s)</span>
                  {t.variants && t.variants.length > 0 && (
                    <span className="text-gray-600 dark:text-gray-400"> — {t.variants.map((c) => `${cellLabel(c)} × ${c.quantity}`).join(', ')}</span>
                  )}
                </p>
                {t.notes && <p className="mt-1 text-sm text-gray-500">Note: {t.notes}</p>}
                {t.rejectionReason && <p className="mt-1 text-sm text-rose-600">Reason: {t.rejectionReason}</p>}

                {(t.canApprove || t.canCancel) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {t.canApprove && (
                      <>
                        <Button size="sm" disabled={busyId === t.id} onClick={() => act(t, 'confirm')}>
                          <Check className="h-4 w-4 mr-1" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => act(t, 'reject')}>
                          <X className="h-4 w-4 mr-1" /> Reject
                        </Button>
                      </>
                    )}
                    {t.canCancel && t.direction !== 'all' && (
                      <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => act(t, 'cancel')}>
                        <Undo2 className="h-4 w-4 mr-1" /> Cancel transfer
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
