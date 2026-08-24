'use client';

import { useEffect, useState } from 'react';
import { useHydratedAuth } from '@/lib/hooks';
import { getBillingInvoice, type InvoiceSnapshot } from '@/lib/billing';

function formatKobo(kobo: number, currency: string): string {
  return `${currency} ${(kobo / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Only renders once there's an actual overage charge to show — no plan has
 * overage configured yet, so for every tenant today this silently renders
 * nothing rather than a permanent "KES 0 overage" line with no information
 * value.
 */
export function InvoicePreview() {
  const { token } = useHydratedAuth();
  const [invoice, setInvoice] = useState<InvoiceSnapshot | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getBillingInvoice(token).then((res) => {
      if (!cancelled && res.success && res.data) setInvoice(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!invoice || invoice.overageKobo <= 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 p-4">
      <div className="flex items-center justify-between text-sm font-medium text-amber-800 dark:text-amber-300">
        <span>Overage charges this period ({invoice.period})</span>
        <span>{formatKobo(invoice.overageKobo, invoice.currency)}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {(invoice.breakdown ?? []).map((item) => (
          <li key={item.limitCode} className="text-xs text-amber-700 dark:text-amber-400 flex items-center justify-between">
            <span>{item.description}</span>
            <span>{formatKobo(item.subtotalKobo, invoice.currency)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-900 flex items-center justify-between text-sm font-semibold text-amber-900 dark:text-amber-200">
        <span>Estimated total this period</span>
        <span>{formatKobo(invoice.totalKobo, invoice.currency)}</span>
      </div>
    </div>
  );
}
