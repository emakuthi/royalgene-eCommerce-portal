'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useHydratedAuth } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import PortalHeader from '@/components/portal/PortalHeader';
import type { TaxInvoice } from '@/lib/types';

function formatKes(cents: number): string {
  return `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;
}

export default function TaxInvoicePage() {
  const params = useParams<{ id: string }>();
  const { token } = useHydratedAuth();
  const [invoice, setInvoice] = useState<TaxInvoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !params?.id) return;
    fetch(`/api/portal/sales/${params.id}/tax-invoice`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setInvoice(json.data);
        else setError(json.error || 'No tax invoice available for this sale');
      })
      .finally(() => setLoading(false));
  }, [token, params?.id]);

  return (
    <div className="w-full">
      <PortalHeader
        backHref="/sales"
        title="Tax Invoice"
        description="KRA-format invoice for your own records — not submitted to KRA"
        breadcrumbs={[{ label: 'Portal', href: '/dashboard' }, { label: 'Sales', href: '/sales' }, { label: 'Tax Invoice' }]}
        actions={invoice ? <Button variant="outline" size="sm" onClick={() => window.print()}>Print</Button> : undefined}
      />

      <div className="px-4 sm:px-6 py-6 max-w-lg mx-auto">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : error || !invoice ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
        ) : (
          <div className="rounded-2xl border border-[hsl(var(--border))] bg-white dark:bg-gray-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Invoice</p>
                <p className="font-semibold text-gray-900 dark:text-white">{invoice.invoiceNumber}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-gray-400">KRA PIN</p>
                <p className="font-semibold text-gray-900 dark:text-white">{invoice.kraPin}</p>
              </div>
            </div>

            <div className="border-t border-[hsl(var(--border))] pt-4 space-y-2">
              {invoice.itemsJson.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="text-gray-900 dark:text-white">{item.description}</p>
                    <p className="text-xs text-gray-400">
                      {item.quantity} × {formatKes(item.unitPrice)} · Tax type {item.taxType}
                    </p>
                  </div>
                  <p className="font-medium text-gray-900 dark:text-white">{formatKes(item.totalAmount)}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-[hsl(var(--border))] pt-4 space-y-1 text-sm">
              <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
                <span>Taxable amount</span>
                <span>{formatKes(invoice.totalTaxableAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-gray-500 dark:text-gray-400">
                <span>Tax</span>
                <span>{formatKes(invoice.totalTaxAmount)}</span>
              </div>
              <div className="flex items-center justify-between font-semibold text-gray-900 dark:text-white text-base pt-1">
                <span>Total</span>
                <span>{formatKes(invoice.totalAmount)}</span>
              </div>
            </div>

            <div className="flex flex-col items-center gap-2 pt-2">
              <Image src={invoice.qrCodeData} alt="Tax invoice QR code" width={140} height={140} unoptimized />
              <p className="text-[11px] text-gray-400 text-center max-w-xs">
                This is a KRA-format invoice for your own records. It has not been submitted to KRA&apos;s eTIMS
                system — live submission requires separate device/software certification.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
