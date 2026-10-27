'use client';

import { useEffect, useState } from 'react';

/** Mirrors ProductSuggestion in src/lib/product-suggest.server.ts. */
export interface ProductSuggestion {
  productId: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string | null;
  brand: string | null;
  price: number | null;
  sizes: string[];
  colors: string[];
  image: string | null;
  shopNames: string[];
  inThisShop: boolean;
}

const DEBOUNCE_MS = 250;

/**
 * Existing products in the business matching what's being typed into a new
 * product's name or SKU — so the same goods keep one spelling and one SKU
 * across every shop.
 */
export function useProductSuggestions(token: string | null, query: string, shopId: string) {
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!token || q.length < 2) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q, shopId });
      fetch(`/api/portal/products/suggest?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
        .then(r => r.json())
        .then(d => { if (d.success) setSuggestions(d.data || []); })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [token, query, shopId]);

  return suggestions;
}

/** Dropdown under the name/SKU field. Picking one copies its details into the form. */
export function ProductSuggestionList({
  suggestions,
  onPick,
}: {
  suggestions: ProductSuggestion[];
  onPick: (s: ProductSuggestion) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-30 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
      <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
        Already in your business — pick one to use the same name &amp; SKU
      </p>
      <ul className="max-h-64 overflow-y-auto">
        {suggestions.map(s => (
          <li key={s.productId}>
            <button
              type="button"
              // mousedown, not click: fires before the input's blur hides the list
              onMouseDown={e => { e.preventDefault(); onPick(s); }}
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {s.image
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={s.image} alt="" className="h-8 w-8 rounded object-cover flex-shrink-0" />
                : <div className="h-8 w-8 rounded bg-gray-100 dark:bg-gray-800 flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.name}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {s.sku ? <span className="font-mono">{s.sku}</span> : 'No SKU'}
                  {s.shopNames.length > 0 && <> · {s.shopNames.join(', ')}</>}
                </p>
              </div>
              {s.inThisShop && (
                <span className="flex-shrink-0 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
                  Already in this shop
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
