'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ScanLine, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Line {
  code: string;
  size: string;
  color: string;
}

const field = 'rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2 text-sm';

/**
 * The scannable codes registered for one product. A code can cover the whole
 * product or point at one size/colour cell, so scanning picks that exact variant.
 * Click the input and scan with a handheld scanner (or type a code) to add it.
 * Saved on its own button, separately from the product form.
 */
export default function BarcodeEditor({
  productId,
  token,
  sizes,
  colors,
  sizeLabel = 'Size',
  colorLabel = 'Colour',
}: {
  productId: string;
  token: string | null | undefined;
  sizes: string[];
  colors: string[];
  sizeLabel?: string;
  colorLabel?: string;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/portal/products/${encodeURIComponent(productId)}/barcodes`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const json = await res.json();
        if (!cancelled && json?.success) {
          setLines((json.data as Line[]).map((b) => ({ code: b.code, size: b.size ?? '', color: b.color ?? '' })));
        }
      } catch {
        if (!cancelled) toast.error('Could not load barcodes');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [productId, token]);

  function addDraft() {
    const code = draft.replace(/[\r\n\t]/g, '').trim();
    if (!code) return;
    if (lines.some((l) => l.code.toLowerCase() === code.toLowerCase())) {
      toast.error(`"${code}" is already in the list`);
    } else {
      setLines((prev) => [...prev, { code, size: '', color: '' }]);
      setDirty(true);
    }
    setDraft('');
    inputRef.current?.focus();
  }

  const update = (i: number, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/portal/products/${encodeURIComponent(productId)}/barcodes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ barcodes: lines }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Could not save barcodes');
      toast.success('Barcodes saved');
      setDirty(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save barcodes');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex items-center text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading barcodes…</div>;
  }

  const hasVariants = sizes.length > 0 || colors.length > 0;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Codes that find this product when scanned at a sale or stock receipt. The SKU always works too.
        {hasVariants && ` Pick a ${sizeLabel.toLowerCase()}/${colorLabel.toLowerCase()} when a code belongs to one variant only.`}
      </p>

      {lines.length === 0 && <p className="text-sm text-gray-500">No barcodes yet.</p>}
      {lines.map((l, i) => (
        <div key={`${l.code}-${i}`} className="flex flex-wrap items-center gap-2">
          <span className="flex-1 min-w-[8rem] font-mono text-sm break-all">{l.code}</span>
          {sizes.length > 0 && (
            <select aria-label={sizeLabel} className={`${field} w-28`} value={l.size} onChange={(e) => update(i, { size: e.target.value })}>
              <option value="">Any {sizeLabel.toLowerCase()}</option>
              {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {colors.length > 0 && (
            <select aria-label={colorLabel} className={`${field} w-28`} value={l.color} onChange={(e) => update(i, { color: e.target.value })}>
              <option value="">Any {colorLabel.toLowerCase()}</option>
              {colors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <button
            type="button"
            aria-label={`Remove barcode ${l.code}`}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
            onClick={() => { setLines((prev) => prev.filter((_, j) => j !== i)); setDirty(true); }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      <div className="relative">
        <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
        <input
          ref={inputRef}
          aria-label="Add barcode"
          className={`${field} w-full pl-9`}
          placeholder="Click here and scan, or type a code and press Enter"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addDraft();
            }
          }}
        />
      </div>

      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save barcodes'}
        </Button>
      </div>
    </div>
  );
}
