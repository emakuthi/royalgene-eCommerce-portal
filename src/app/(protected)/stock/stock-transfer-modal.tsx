'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRightLeft, X } from 'lucide-react';
import type { Shop, ShopStock, Product } from '@/lib/types';

type ApiShopStock = ShopStock & { Product?: Product; product?: Product; shopName?: string };

interface StockTransferModalProps {
  open: boolean;
  stock: ApiShopStock | null;
  currentShopId: string;
  token: string | null | undefined;
  onClose: () => void;
  /** Called after a successful transfer with the new source quantity */
  onTransferred: (stockId: string, newQuantity: number) => void;
}

export default function StockTransferModal({
  open,
  stock,
  currentShopId,
  token,
  onClose,
  onTransferred,
}: StockTransferModalProps) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [toShopId, setToShopId] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingShops, setLoadingShops] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const prod = stock ? (stock.product ?? stock.Product) : null;
  const maxQty = stock?.quantity ?? 0;

  // Load available destination shops whenever the modal opens
  useEffect(() => {
    if (!open || !token) return;
    setError(null);
    setSuccess(null);
    setToShopId('');
    setQuantity('');
    setNotes('');
    setLoadingShops(true);

    fetch('/api/portal/shops', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(j => {
        if (j.success && Array.isArray(j.data)) {
          // Exclude the current shop so user can only transfer TO another shop
          setShops((j.data as Shop[]).filter(s => s.id !== currentShopId));
        }
      })
      .catch(() => setError('Failed to load shops'))
      .finally(() => setLoadingShops(false));
  }, [open, token, currentShopId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stock) return;

    setError(null);
    setSuccess(null);

    const qty = Number(quantity);
    if (!toShopId) { setError('Please select a destination shop'); return; }
    if (!qty || qty <= 0) { setError('Enter a valid quantity'); return; }
    if (qty > maxQty) { setError(`Cannot transfer more than ${maxQty} units`); return; }

    setLoading(true);
    try {
      const res = await fetch('/api/portal/stock/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fromShopStockId: stock.id, toShopId, quantity: qty, notes: notes.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Transfer failed');
        return;
      }
      setSuccess(json.message || 'Transfer successful');
      onTransferred(stock.id, json.data.newSourceQuantity);
      // Auto-close after 1.5 s
      setTimeout(onClose, 1500);
    } catch {
      setError('Transfer failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!open || !stock) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 z-40"
        onClick={() => { if (!loading) onClose(); }}
      />

      {/* Panel */}
      <div className="relative z-50 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b dark:border-gray-700">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5 text-blue-600" />
            <h3 className="text-lg font-semibold">Transfer Stock</h3>
          </div>
          <button
            type="button"
            className="rounded-full p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => { if (!loading) onClose(); }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="px-6 py-5 space-y-4">
          {/* Product info */}
          <div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-3 flex items-center gap-3">
            {prod && Array.isArray((prod as Product).images) && (prod as Product).images.length > 0 && (
              <img
                src={(prod as Product).images[0]}
                alt={prod.name}
                className="h-12 w-12 rounded-md object-cover border"
              />
            )}
            <div>
              <p className="font-medium text-sm">{prod?.name ?? 'Product'}</p>
              <p className="text-xs text-gray-500">SKU: {prod?.sku ?? '—'} &middot; Available: <span className="font-semibold text-emerald-600">{maxQty}</span></p>
            </div>
          </div>

          {/* Destination shop */}
          <div>
            <label className="block text-sm font-medium mb-1">Destination Shop</label>
            {loadingShops ? (
              <p className="text-sm text-gray-400">Loading shops…</p>
            ) : shops.length === 0 ? (
              <p className="text-sm text-amber-600">No other shops available for transfer.</p>
            ) : (
              <select
                value={toShopId}
                onChange={e => setToShopId(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select a shop…</option>
                {shops.map(s => (
                  <option key={s.id} value={s.id}>{s.name}{s.location ? ` — ${s.location}` : ''}</option>
                ))}
              </select>
            )}
          </div>

          {/* Quantity */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Quantity to Transfer
              <span className="ml-1 text-xs text-gray-400">(max {maxQty})</span>
            </label>
            <Input
              type="number"
              min={1}
              max={maxQty}
              value={quantity}
              onChange={e => setQuantity(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={`1 – ${maxQty}`}
              required
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium mb-1">Notes <span className="text-xs text-gray-400">(optional)</span></label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reason for transfer…"
            />
          </div>

          {/* Feedback */}
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 px-4 py-2 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          {success && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              ✅ {success}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700 text-white"
              disabled={loading || loadingShops || shops.length === 0}
            >
              {loading ? 'Transferring…' : 'Transfer'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

