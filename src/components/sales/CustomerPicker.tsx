'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney } from '@/lib/currency';

export interface PickedCustomer { id: string; name: string; phone: string | null; balance: number }

const select = 'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-2 text-sm';

/** Who a credit sale is to: pick an existing customer or add one on the spot. */
export default function CustomerPicker({
  token, value, currency, onChange,
}: {
  token: string | null | undefined;
  value: string;
  currency: string;
  onChange: (customer: PickedCustomer | null) => void;
}) {
  const [customers, setCustomers] = useState<PickedCustomer[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch('/api/portal/customers', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (j?.success) setCustomers(j.data ?? []); })
      .catch(() => {});
  }, [token]);

  async function add() {
    setBusy(true);
    try {
      const j = await fetch('/api/portal/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, phone }),
      }).then((r) => r.json());
      if (!j?.success) { toast.error(j?.error || 'Could not add the customer'); return; }
      const c: PickedCustomer = { ...j.data, balance: 0 };
      setCustomers((list) => [c, ...list]);
      onChange(c);
      setAdding(false); setName(''); setPhone('');
    } finally {
      setBusy(false);
    }
  }

  const picked = customers.find((c) => c.id === value);
  return (
    <div className="rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 p-3 space-y-2">
      <div className="text-sm font-medium">Customer who owes this *</div>
      {adding ? (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="New customer name" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" aria-label="New customer phone" />
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={add} disabled={busy || name.trim().length < 2}>{busy ? 'Adding…' : 'Add customer'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            className={select}
            value={value}
            onChange={(e) => onChange(customers.find((c) => c.id === e.target.value) ?? null)}
            aria-label="Customer"
          >
            <option value="">Choose a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.phone ? ` · ${c.phone}` : ''}{c.balance > 0 ? ` (owes ${formatMoney(c.balance, currency)})` : ''}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" onClick={() => setAdding(true)} className="shrink-0">New customer</Button>
        </div>
      )}
      {picked && picked.balance > 0 && (
        <p className="text-xs text-rose-700 dark:text-rose-300">{picked.name} already owes {formatMoney(picked.balance, currency)}.</p>
      )}
    </div>
  );
}
