'use client';
import { useBranding } from '@/lib/branding-context';
import { currencySymbol } from '@/lib/currency';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Plus, Tag, X } from 'lucide-react';
import type { Product, ShopStock, ShopStockVariant } from '@/lib/types';

/** "1500" -> 1500, "" / garbage -> undefined (so it's simply omitted, not sent as 0). */
function parseAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

type ApiShopStock = ShopStock & { Product?: Product; product?: Product; shopName?: string };

const norm = (v: string) => v.trim();
/** Local cell key. Server stores size/color verbatim; axes drive the payload. */
const cellKey = (size: string, color: string) => `${norm(size)} ${norm(color)}`;
const LABEL_ANY = '—';

function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = norm(raw);
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

export default function VariantMatrixModal({
  open,
  stock,
  token,
  onClose,
  onSaved,
}: {
  open: boolean;
  stock: ApiShopStock;
  token: string | null | undefined;
  onClose: () => void;
  onSaved: (stockId: string, newTotal: number) => void;
}) {
  const product = (stock.product ?? stock.Product) as Product | undefined;
  const curSym = currencySymbol(useBranding().branding.currency);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hadVariants, setHadVariants] = useState(false);
  const [flatQuantity, setFlatQuantity] = useState<number>(stock.quantity ?? 0);

  // Axes and per-cell quantities (as strings so a field can be blank while typing).
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [newSize, setNewSize] = useState('');
  const [newColor, setNewColor] = useState('');

  // Per-cell price overrides — optional. A cell with nothing set here just
  // sells at the product's own flat price/cost, so a product that doesn't
  // need per-size pricing is completely unaffected.
  const [cellPrices, setCellPrices] = useState<Record<string, { price?: number; costPrice?: number }>>({});
  const [priceEditorCell, setPriceEditorCell] = useState<{ size: string; color: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/stock/${stock.id}/variants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error || 'Failed to load breakdown');
        return;
      }
      const data = json.data as {
        cells: ShopStockVariant[];
        hasVariants: boolean;
        flatQuantity?: number;
      };
      const cellSizes = data.cells.map((c) => c.size).filter(Boolean);
      const cellColors = data.cells.map((c) => c.color).filter(Boolean);
      setSizes(uniqueOrdered([...(product?.sizes ?? []), ...cellSizes]));
      setColors(uniqueOrdered([...(product?.colors ?? []), ...cellColors]));

      const next: Record<string, string> = {};
      const nextPrices: Record<string, { price?: number; costPrice?: number }> = {};
      for (const c of data.cells) {
        const key = cellKey(c.size, c.color);
        next[key] = String(c.quantity ?? 0);
        if (typeof c.price === 'number' || typeof c.costPrice === 'number') {
          nextPrices[key] = {
            price: typeof c.price === 'number' ? c.price : undefined,
            costPrice: typeof c.costPrice === 'number' ? c.costPrice : undefined,
          };
        }
      }
      setCells(next);
      setCellPrices(nextPrices);
      setHadVariants(data.hasVariants);
      setFlatQuantity(Number(data.flatQuantity ?? stock.quantity ?? 0));
    } catch (err) {
      console.error('[VariantMatrix] load failed', err);
      toast.error('Failed to load breakdown');
    } finally {
      setLoading(false);
    }
  }, [stock.id, stock.quantity, product?.sizes, product?.colors, token]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // A single-value axis (`['']`) means "this product has no size / colour dimension".
  const rowAxis = useMemo(() => (sizes.length > 0 ? sizes : ['']), [sizes]);
  const colAxis = useMemo(() => (colors.length > 0 ? colors : ['']), [colors]);

  const qtyAt = useCallback(
    (size: string, color: string) => {
      const raw = cells[cellKey(size, color)];
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    },
    [cells],
  );

  const setQtyAt = (size: string, color: string, value: string) => {
    setCells((prev) => ({ ...prev, [cellKey(size, color)]: value }));
  };

  const { rowTotals, colTotals, grandTotal } = useMemo(() => {
    const rt: Record<string, number> = {};
    const ct: Record<string, number> = {};
    let total = 0;
    for (const s of rowAxis) {
      for (const c of colAxis) {
        const q = qtyAt(s, c);
        rt[s] = (rt[s] ?? 0) + q;
        ct[c] = (ct[c] ?? 0) + q;
        total += q;
      }
    }
    return { rowTotals: rt, colTotals: ct, grandTotal: total };
  }, [rowAxis, colAxis, qtyAt]);

  const addSize = () => {
    const v = norm(newSize);
    if (!v) return;
    if (sizes.some((s) => s.toLowerCase() === v.toLowerCase())) {
      toast.error('That size is already listed');
      return;
    }
    setSizes((prev) => [...prev, v]);
    setNewSize('');
  };
  const addColor = () => {
    const v = norm(newColor);
    if (!v) return;
    if (colors.some((c) => c.toLowerCase() === v.toLowerCase())) {
      toast.error('That colour is already listed');
      return;
    }
    setColors((prev) => [...prev, v]);
    setNewColor('');
  };
  const removeSize = (size: string) =>
    setSizes((prev) => prev.filter((s) => s !== size));
  const removeColor = (color: string) =>
    setColors((prev) => prev.filter((c) => c !== color));

  const submit = async (clear = false) => {
    setSaving(true);
    try {
      // A cell is worth sending even at zero stock if it already has its own
      // price/cost set — otherwise a price entered before any quantity would
      // be silently dropped here and never reach the server.
      const payloadCells = clear
        ? []
        : rowAxis.flatMap((s) =>
            colAxis
              .map((c) => {
                const override = cellPrices[cellKey(s, c)];
                return {
                  size: s,
                  color: c,
                  quantity: qtyAt(s, c),
                  price: override?.price,
                  costPrice: override?.costPrice,
                };
              })
              .filter((cell) => cell.quantity > 0 || cell.price !== undefined || cell.costPrice !== undefined),
          );

      const res = await fetch(`/api/portal/stock/${stock.id}/variants`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cells: payloadCells }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        toast.error(json.error || 'Failed to save breakdown');
        return;
      }
      const newTotal = Number(json.data?.total ?? 0);
      onSaved(stock.id, newTotal);
      toast.success(
        clear ? 'Breakdown cleared — shop total is now flat' : 'Size / colour breakdown saved',
      );
      onClose();
    } catch (err) {
      console.error('[VariantMatrix] save failed', err);
      toast.error('Failed to save breakdown');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const busy = saving || loading;
  const totalMatchesFlat = grandTotal === flatQuantity;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40 z-40"
        onClick={() => { if (!busy) onClose(); }}
      />
      <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-3xl z-50 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b dark:border-gray-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold">Size &amp; colour breakdown</h3>
              <p className="text-sm text-muted-foreground">
                {product?.name || 'Product'} · {stock.shopName ?? 'this shop'}
              </p>
            </div>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-4">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Enter how many of each size / colour this shop holds. The shop total
                becomes the sum of every cell, and each sale takes stock from the
                matching cell. Leave everything at zero and save (or use{' '}
                <span className="font-medium">Clear breakdown</span>) to go back to a
                single flat quantity. Tap <span className="font-medium">Same price</span> under
                any cell if that size or colour sells for a different amount — leave it alone
                to keep using this product&apos;s own price for every cell.
              </p>

              <div className="overflow-x-auto">
                <table className="text-sm border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 text-left font-medium text-muted-foreground sticky left-0 bg-white dark:bg-gray-900">
                        Size \ Colour
                      </th>
                      {colAxis.map((c) => (
                        <th key={c || '_any'} className="p-2 font-medium min-w-[5rem]">
                          <div className="flex items-center justify-center gap-1">
                            <span>{c || LABEL_ANY}</span>
                            {c && colors.length > 0 && (
                              <button
                                type="button"
                                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                onClick={() => removeColor(c)}
                                title="Remove colour from grid"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="p-2 font-medium text-muted-foreground min-w-[4rem]">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rowAxis.map((s) => (
                      <tr key={s || '_any'} className="border-t dark:border-gray-800">
                        <th className="p-2 text-left font-medium sticky left-0 bg-white dark:bg-gray-900">
                          <div className="flex items-center gap-1">
                            <span>{s || LABEL_ANY}</span>
                            {s && sizes.length > 0 && (
                              <button
                                type="button"
                                className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                                onClick={() => removeSize(s)}
                                title="Remove size from grid"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </th>
                        {colAxis.map((c) => {
                          const override = cellPrices[cellKey(s, c)];
                          const hasCustomPrice = override?.price !== undefined || override?.costPrice !== undefined;
                          return (
                            <td key={(s || '_') + (c || '_')} className="p-1">
                              <div className="flex flex-col items-center gap-1">
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  className="h-9 w-20 text-center rounded-md border border-gray-300 dark:border-gray-700 bg-transparent px-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                                  value={cells[cellKey(s, c)] ?? ''}
                                  onChange={(e) => setQtyAt(s, c, e.target.value)}
                                  onFocus={(e) => e.currentTarget.select()}
                                />
                                <button
                                  type="button"
                                  className={`flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 ${
                                    hasCustomPrice
                                      ? 'text-[hsl(var(--primary-foreground))] bg-[hsl(var(--primary))] bg-opacity-10'
                                      : 'text-muted-foreground hover:bg-gray-100 dark:hover:bg-gray-800'
                                  }`}
                                  onClick={() => setPriceEditorCell({ size: s, color: c })}
                                  title="Set a price/cost just for this size/colour"
                                >
                                  <Tag className="w-3 h-3" />
                                  {override?.price !== undefined
                                    ? `${curSym} ${override.price}`
                                    : hasCustomPrice ? 'Custom cost' : 'Same price'}
                                </button>
                              </div>
                            </td>
                          );
                        })}
                        <td className="p-2 text-center font-semibold">{rowTotals[s] ?? 0}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 dark:border-gray-700">
                      <th className="p-2 text-left font-medium text-muted-foreground sticky left-0 bg-white dark:bg-gray-900">
                        Total
                      </th>
                      {colAxis.map((c) => (
                        <td key={(c || '_') + '_total'} className="p-2 text-center font-semibold">
                          {colTotals[c] ?? 0}
                        </td>
                      ))}
                      <td className="p-2 text-center font-bold">{grandTotal}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Add axes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-muted-foreground mb-1">Add a size</label>
                    <Input
                      value={newSize}
                      onChange={(e) => setNewSize(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } }}
                      placeholder="e.g. XL"
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={addSize} className="gap-1">
                    <Plus className="w-4 h-4" />Add
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs text-muted-foreground mb-1">Add a colour</label>
                    <Input
                      value={newColor}
                      onChange={(e) => setNewColor(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } }}
                      placeholder="e.g. Navy"
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={addColor} className="gap-1">
                    <Plus className="w-4 h-4" />Add
                  </Button>
                </div>
              </div>

              <div
                className={`text-sm rounded-md px-3 py-2 ${
                  totalMatchesFlat
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
                }`}
              >
                Breakdown sums to <span className="font-semibold">{grandTotal}</span>.
                {' '}Current shop total is <span className="font-semibold">{flatQuantity}</span>.
                {!totalMatchesFlat && ' Saving will set the shop total to the breakdown sum.'}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t dark:border-gray-800 flex items-center justify-between gap-3">
          <div>
            {hadVariants && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                disabled={busy}
                onClick={() => void submit(true)}
              >
                Clear breakdown
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              type="button"
              className="bg-[hsl(var(--primary))] text-white"
              disabled={busy}
              onClick={() => void submit(false)}
            >
              {saving ? 'Saving…' : 'Save breakdown'}
            </Button>
          </div>
        </div>
      </div>

      {priceEditorCell && (
        <CellPriceEditor
          size={priceEditorCell.size}
          color={priceEditorCell.color}
          initial={cellPrices[cellKey(priceEditorCell.size, priceEditorCell.color)]}
          onClose={() => setPriceEditorCell(null)}
          onSave={(price, costPrice) => {
            const key = cellKey(priceEditorCell.size, priceEditorCell.color);
            setCellPrices((prev) => {
              if (price === undefined && costPrice === undefined) {
                const next = { ...prev };
                delete next[key];
                return next;
              }
              return { ...prev, [key]: { price, costPrice } };
            });
            setPriceEditorCell(null);
          }}
        />
      )}
    </div>
  );
}

/** One (size, colour) cell's own price/cost override — a small modal over the main one. */
function CellPriceEditor({
  size,
  color,
  initial,
  onClose,
  onSave,
}: {
  size: string;
  color: string;
  initial: { price?: number; costPrice?: number } | undefined;
  onClose: () => void;
  onSave: (price: number | undefined, costPrice: number | undefined) => void;
}) {
  const [priceText, setPriceText] = useState(initial?.price !== undefined ? String(initial.price) : '');
  const [costPriceText, setCostPriceText] = useState(initial?.costPrice !== undefined ? String(initial.costPrice) : '');
  const label = [size, color].filter(Boolean).join(' / ') || 'this item';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 z-[59]" onClick={onClose} />
      <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-sm z-[60] p-6 space-y-4">
        <div>
          <h4 className="text-base font-semibold">Price for {label}</h4>
          <p className="text-sm text-muted-foreground mt-1">
            Leave blank to use this product&apos;s own price/cost.
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Sale price (optional)</label>
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              placeholder="e.g. 1500"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Cost price (optional)</label>
            <Input
              type="number"
              min={0}
              inputMode="decimal"
              value={costPriceText}
              onChange={(e) => setCostPriceText(e.target.value)}
              placeholder="e.g. 900"
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <div>
            {(initial?.price !== undefined || initial?.costPrice !== undefined) && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={() => onSave(undefined, undefined)}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              className="bg-[hsl(var(--primary))] text-white"
              onClick={() => onSave(parseAmount(priceText), parseAmount(costPriceText))}
            >
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
