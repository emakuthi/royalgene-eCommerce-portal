'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Paperclip, Receipt as ReceiptIcon } from 'lucide-react';
import ReceiptViewer from '@/components/receipts/ReceiptViewer';
import { formatMoney } from '@/lib/currency';
import { businessDateKey } from '@/lib/business-time';
import { RECEIPT_ACCEPT, getDriveStatus, listReceipts, uploadReceipt, type Receipt } from '@/lib/receipts';

/**
 * The supplier receipts for a product's stock purchases, on the product view:
 * list, open, and attach another (saved to the workspace's Google Drive).
 * Renders nothing for people who can't manage receipts or before Drive is connected.
 */
export default function ProductReceipts({
  token, productId, productName, shopId, currency,
}: {
  token: string | null;
  productId: string;
  productName: string;
  shopId?: string | null;
  currency: string;
}) {
  const [on, setOn] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [viewing, setViewing] = useState<Receipt | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token || !productId) return;
    let cancelled = false;
    (async () => {
      const status = await getDriveStatus(token);
      const ready = Boolean(status.success && status.data?.canManageReceipts && status.data.connected);
      if (cancelled) return;
      setOn(ready);
      if (!ready) return;
      const res = await listReceipts(token, { productId });
      if (!cancelled && res.success) setReceipts(res.data ?? []);
    })();
    return () => { cancelled = true; };
  }, [token, productId]);

  if (!on) return null;

  async function attach(file: File) {
    setUploading(true);
    const res = await uploadReceipt(token, file, {
      productId,
      shopId: shopId ?? undefined,
      currency,
      receiptDate: businessDateKey(),
      notes: `Stock purchase: ${productName}`,
    });
    setUploading(false);
    if (input.current) input.current.value = '';
    if (!res.success || !res.data) { toast.error(res.error || 'Could not save the receipt'); return; }
    setReceipts(prev => [res.data as Receipt, ...prev]);
    toast.success('Receipt saved to Google Drive');
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 dark:text-gray-400">Purchase receipts</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
        >
          <Paperclip className="h-3.5 w-3.5" />{uploading ? 'Saving…' : 'Attach receipt'}
        </button>
        <input ref={input} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void attach(f); }} />
      </div>
      {receipts.length === 0 ? (
        <p className="text-xs text-gray-400 mt-1">None yet. Attach the supplier&apos;s receipt when you restock.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {receipts.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => setViewing(r)} className="w-full flex items-center gap-2 text-left text-sm rounded-md px-2 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ReceiptIcon className="h-4 w-4 text-gray-400 shrink-0" />
                <span className="truncate flex-1">{r.supplier || r.fileName}</span>
                <span className="text-xs text-gray-500 whitespace-nowrap">
                  {[r.receiptDate, r.amount != null ? formatMoney(r.amount, r.currency ?? currency) : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <ReceiptViewer
          token={token}
          receipts={[viewing]}
          onClose={() => setViewing(null)}
          onDeleted={id => { setReceipts(prev => prev.filter(r => r.id !== id)); setViewing(null); }}
        />
      )}
    </div>
  );
}
