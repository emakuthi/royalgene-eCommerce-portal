'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import PortalHeader from '@/components/portal/PortalHeader';
import { useHydratedAuth } from '@/lib/hooks';
import { useBranding } from '@/lib/branding-context';
import { formatMoney } from '@/lib/currency';
import { formatBusinessDateTime } from '@/lib/business-time';

interface Detail {
  customer: { id: string; name: string; phone: string | null; notes: string | null };
  owedTotal: number;
  paidTotal: number;
  balance: number;
  sales: Array<{ id: string; shopId: string; soldAt: string; total: number; onCredit: number; items: number }>;
  payments: Array<{ id: string; shopId: string; amount: number; method: string; note: string | null; receivedAt: string }>;
  canDeletePayments: boolean;
}
interface Shop { id: string; name: string }

const select = 'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-2 text-sm';

/** One credit customer: balance, their credit sales and repayments, and recording a payment. */
export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token, user } = useHydratedAuth();
  const currency = useBranding().branding.currency;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [shopId, setShopId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const headers = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  const load = useCallback(async () => {
    if (!token || !id) return;
    const [d, s] = await Promise.all([
      fetch(`/api/portal/customers/${id}`, { headers: headers(), cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/portal/shops', { headers: headers() }).then((r) => r.json()).catch(() => ({})),
    ]);
    if (d?.success) {
      setDetail(d.data);
      setName(d.data.customer.name);
      setPhone(d.data.customer.phone ?? '');
    } else {
      toast.error(d?.error || 'Customer not found');
    }
    if (s?.success) {
      const list = (s.data ?? []).map((x: Shop) => ({ id: x.id, name: x.name }));
      setShops(list);
      setShopId((cur) => cur || list[0]?.id || '');
    }
  }, [token, id, headers]);

  useEffect(() => { void load(); }, [load]);

  const shopName = (sid: string) => shops.find((s) => s.id === sid)?.name ?? 'Shop';

  async function recordPayment() {
    setBusy(true);
    try {
      const j = await fetch(`/api/portal/customers/${id}/payments`, {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ id: crypto.randomUUID(), amount: Number(amount), method, shopId, note }),
      }).then((r) => r.json());
      if (!j?.success) { toast.error(j?.error || 'Could not record the payment'); return; }
      toast.success('Payment recorded');
      setAmount(''); setNote('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function removePayment(paymentId: string) {
    if (!window.confirm('Undo this payment? The amount goes back onto what they owe.')) return;
    const j = await fetch(`/api/portal/customers/${id}/payments/${paymentId}`, { method: 'DELETE', headers: headers() }).then((r) => r.json()).catch(() => ({}));
    if (!j?.success) { toast.error(j?.error || 'Could not undo the payment'); return; }
    toast.success('Payment removed');
    await load();
  }

  async function saveDetails() {
    const j = await fetch(`/api/portal/customers/${id}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ name, phone }) })
      .then((r) => r.json()).catch(() => ({}));
    if (!j?.success) { toast.error(j?.error || 'Could not save'); return; }
    setEditing(false);
    await load();
  }

  async function removeCustomer() {
    if (!window.confirm('Remove this customer from the list? Their past sales stay in Sales.')) return;
    const j = await fetch(`/api/portal/customers/${id}`, { method: 'DELETE', headers: headers() }).then((r) => r.json()).catch(() => ({}));
    if (!j?.success) { toast.error(j?.error || 'Could not remove the customer'); return; }
    toast.success('Customer removed');
    router.push('/customers');
  }

  if (!detail) {
    return <div className="px-6 py-10 text-sm text-gray-400">Loading…</div>;
  }
  const { customer, balance } = detail;
  const isOwner = user?.role === 'admin';

  return (
    <>
      <PortalHeader
        backHref="/customers"
        title={customer.name}
        description={customer.phone || 'No phone'}
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Customers', href: '/customers' }, { label: customer.name }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing((v) => !v)}><Pencil className="h-4 w-4 mr-1" />Edit</Button>
            {isOwner && <Button variant="outline" onClick={removeCustomer} disabled={Math.abs(balance) >= 0.01} title={Math.abs(balance) >= 0.01 ? 'Settle the balance first' : undefined}>Remove</Button>}
          </div>
        }
      />

      <div className="px-4 sm:px-6 py-4 space-y-4 max-w-4xl">
        {editing && (
          <Card><CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Customer name" />
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" aria-label="Customer phone" />
            </div>
            <Button onClick={saveDetails} disabled={name.trim().length < 2}>Save</Button>
          </CardContent></Card>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card><CardContent className="p-4">
            <div className="text-xs text-gray-500">{balance < 0 ? 'Paid ahead' : 'Owes'}</div>
            <div className={`text-2xl font-semibold ${balance > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-green-600 dark:text-green-400'}`}>
              {formatMoney(Math.abs(balance), currency)}
            </div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-gray-500">Bought on credit</div>
            <div className="text-xl font-semibold">{formatMoney(detail.owedTotal, currency)}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-gray-500">Paid back</div>
            <div className="text-xl font-semibold">{formatMoney(detail.paidTotal, currency)}</div>
          </CardContent></Card>
        </div>

        <Card><CardContent className="p-4 space-y-3">
          <h2 className="text-base font-semibold">Record a payment</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={balance > 0 ? String(balance) : 'Amount'} aria-label="Amount paid" />
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={select} aria-label="Paid with">
              <option>Cash</option><option>M-Pesa</option><option>Card</option>
            </select>
            <select value={shopId} onChange={(e) => setShopId(e.target.value)} className={select} aria-label="Shop that received it">
              {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={recordPayment} disabled={busy || !(Number(amount) > 0) || !shopId}>{busy ? 'Saving…' : 'Record payment'}</Button>
            {balance > 0 && <Button variant="outline" onClick={() => setAmount(String(balance))} disabled={busy}>Paid in full</Button>}
          </div>
        </CardContent></Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card><CardContent className="p-4">
            <h2 className="text-base font-semibold mb-2">Credit sales</h2>
            {detail.sales.length === 0 ? <p className="text-sm text-gray-500">None.</p> : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {detail.sales.map((s) => (
                  <li key={s.id} className="py-2 flex justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div>{formatBusinessDateTime(s.soldAt)}</div>
                      <div className="text-xs text-gray-500 truncate">{shopName(s.shopId)} · {s.items} item{s.items === 1 ? '' : 's'} · total {formatMoney(s.total, currency)}</div>
                    </div>
                    <div className="font-medium text-rose-600 dark:text-rose-400 shrink-0">{formatMoney(s.onCredit, currency)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>

          <Card><CardContent className="p-4">
            <h2 className="text-base font-semibold mb-2">Payments</h2>
            {detail.payments.length === 0 ? <p className="text-sm text-gray-500">None yet.</p> : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {detail.payments.map((p) => (
                  <li key={p.id} className="py-2 flex justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div>{formatBusinessDateTime(p.receivedAt)}</div>
                      <div className="text-xs text-gray-500 truncate">{p.method} · {shopName(p.shopId)}{p.note ? ` · ${p.note}` : ''}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-medium text-green-600 dark:text-green-400">{formatMoney(p.amount, currency)}</span>
                      {detail.canDeletePayments && (
                        <button onClick={() => removePayment(p.id)} aria-label="Undo payment" className="text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent></Card>
        </div>
      </div>
    </>
  );
}
