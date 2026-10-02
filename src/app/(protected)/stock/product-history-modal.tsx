'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useHydratedAuth } from '@/lib/hooks';

interface HistoryChange { field: string; from: string | null; to: string | null }
interface HistoryEvent {
  id: string;
  type: string;
  timestamp: string;
  title: string;
  actorName: string | null;
  shopName: string | null;
  quantityBefore: number | null;
  quantityAfter: number | null;
  reference: string | null;
  note: string | null;
  changes: HistoryChange[] | null;
}

const TYPE_ICON: Record<string, string> = {
  created: '🆕', sale: '🛒', restock: '📦', adjustment: '⚙️',
  transfer_in: '↘️', transfer_out: '↗️', edit: '✏️', stock_change: '🔄',
};

function formatTs(ts: string): string {
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

/** Self-contained product history timeline modal. Fetches on open. */
export default function ProductHistoryModal({
  productId,
  productName,
  open,
  onClose,
}: {
  productId: string | undefined;
  productName?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { token } = useHydratedAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<HistoryEvent[]>([]);

  useEffect(() => {
    if (!open || !productId || !token) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/portal/products/${encodeURIComponent(productId)}/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && json?.success) {
          setEvents((json.data?.events ?? []) as HistoryEvent[]);
        } else {
          setError(json?.error || 'Could not load history.');
        }
      } catch {
        if (!cancelled) setError('Could not load history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, productId, token]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-xl z-[61] max-h-[85vh] flex flex-col overflow-hidden">
        <div className="sticky top-0 bg-white dark:bg-gray-900 p-5 border-b flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Product History</h3>
            {productName ? <p className="text-sm text-muted-foreground">{productName}</p> : null}
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-muted-foreground py-6 text-center">Loading history…</p>}
          {!loading && error && (
            <p className="text-sm text-red-500 py-6 text-center">{error}</p>
          )}
          {!loading && !error && events.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">No history yet for this product.</p>
          )}
          {!loading && !error && events.length > 0 && (
            <ul className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="flex gap-3 border-b border-gray-100 dark:border-gray-800 pb-3 last:border-0">
                  <span className="text-xl leading-none mt-0.5">{TYPE_ICON[e.type] ?? '•'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{e.title}</p>
                    {e.quantityBefore != null && e.quantityAfter != null && (
                      <p className="text-xs text-muted-foreground">{e.quantityBefore} → {e.quantityAfter}</p>
                    )}
                    {e.changes?.map((c, i) => (
                      <p key={i} className="text-xs text-muted-foreground">
                        {c.field}: {c.from ?? '—'} → {c.to ?? '—'}
                      </p>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      {[e.actorName ? `by ${e.actorName}` : null, e.shopName, formatTs(e.timestamp)]
                        .filter(Boolean)
                        .join('  •  ')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
