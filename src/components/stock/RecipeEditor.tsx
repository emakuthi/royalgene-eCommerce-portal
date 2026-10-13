'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isMeasuredUnit } from '@/lib/business-types';

export interface IngredientOption {
  id: string;
  name: string;
  unit: string;
}

interface Line {
  ingredientProductId: string;
  quantity: string;
}

const field = 'rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm';

/**
 * A menu item's recipe: which stocked products go into ONE of it, and how
 * much. Selling the menu item uses these up at the selling shop. Saved on its
 * own button, separately from the product form.
 */
export default function RecipeEditor({
  productId,
  token,
  ingredients,
}: {
  productId: string;
  token: string | null | undefined;
  /** Stocked (non-menu) products to choose from. */
  ingredients: IngredientOption[];
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/portal/products/${productId}/recipe`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        const json = await res.json();
        if (!cancelled && json?.success) {
          setLines((json.data.items as { ingredientProductId: string; quantity: number }[]).map((i) => ({
            ingredientProductId: i.ingredientProductId,
            quantity: String(i.quantity),
          })));
        }
      } catch {
        if (!cancelled) toast.error('Could not load the recipe');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [productId, token]);

  const unitOf = (id: string) => ingredients.find((i) => i.id === id)?.unit ?? 'piece';
  const update = (i: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  async function save() {
    const items = lines
      .filter((l) => l.ingredientProductId)
      .map((l) => ({ ingredientProductId: l.ingredientProductId, quantity: Number(l.quantity) }));
    setSaving(true);
    try {
      const res = await fetch(`/api/portal/products/${productId}/recipe`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ items }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save the recipe');
      toast.success('Recipe saved');
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the recipe');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading recipe…</div>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        What goes into one of this item. Selling it uses these up at the selling shop; it is never blocked if an ingredient count runs short.
      </p>
      {lines.length === 0 && <p className="text-sm text-gray-500">No ingredients yet.</p>}
      {lines.map((l, i) => {
        const unit = unitOf(l.ingredientProductId);
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Ingredient"
              className={`${field} flex-1 min-w-[10rem]`}
              value={l.ingredientProductId}
              onChange={(e) => update(i, { ingredientProductId: e.target.value })}
            >
              <option value="">Choose ingredient…</option>
              {ingredients.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input
              aria-label="Amount"
              type="number"
              min={0}
              step={isMeasuredUnit(unit) ? 'any' : 1}
              className={`${field} w-24`}
              value={l.quantity}
              onChange={(e) => update(i, { quantity: e.target.value })}
            />
            <span className="text-sm text-gray-500 w-12">{unit}</span>
            <button
              type="button"
              aria-label="Remove ingredient"
              className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
              onClick={() => { setLines((prev) => prev.filter((_, j) => j !== i)); setDirty(true); }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => { setLines((prev) => [...prev, { ingredientProductId: '', quantity: '1' }]); setDirty(true); }}>
          <Plus className="h-4 w-4" />Add ingredient
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save recipe'}
        </Button>
      </div>
    </div>
  );
}
