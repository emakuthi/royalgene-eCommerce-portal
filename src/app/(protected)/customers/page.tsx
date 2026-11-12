'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import PortalHeader from '@/components/portal/PortalHeader';
import { useHydratedAuth } from '@/lib/hooks';
import { useBranding } from '@/lib/branding-context';
import { formatMoney } from '@/lib/currency';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  owedTotal: number;
  paidTotal: number;
  balance: number;
}

/** Credit customers (deni): who owes what, biggest debt first. */
export default function CustomersPage() {
  const { token } = useHydratedAuth();
  const currency = useBranding().branding.currency;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [onlyOwing, setOnlyOwing] = useState(true);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const j = await fetch('/api/portal/customers', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).then((r) => r.json());
      if (j?.success) setCustomers(j.data ?? []);
      else toast.error(j?.error || 'Could not load customers');
    } catch {
      toast.error('Could not load customers');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function addCustomer() {
    setAdding(true);
    try {
      const j = await fetch('/api/portal/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, phone }),
      }).then((r) => r.json());
      if (!j?.success) { toast.error(j?.error || 'Could not add the customer'); return; }
      toast.success(`${j.data.name} added`);
      setName(''); setPhone(''); setShowAdd(false);
      await load();
    } finally {
      setAdding(false);
    }
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers.filter((c) =>
      (!onlyOwing || c.balance > 0) &&
      (!q || c.name.toLowerCase().includes(q) || (c.phone ?? '').replace(/\s/g, '').includes(q.replace(/\s/g, ''))));
  }, [customers, query, onlyOwing]);

  const totalOwed = customers.reduce((t, c) => t + Math.max(c.balance, 0), 0);
  const owingCount = customers.filter((c) => c.balance > 0).length;

  return (
    <>
      <PortalHeader
        backHref="/dashboard"
        title="Customers"
        description="Sales on credit (deni): who owes what, and what they've paid back"
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Customers' }]}
        actions={<Button onClick={() => setShowAdd((v) => !v)} className="bg-[hsl(var(--primary))] text-white"><Plus className="h-4 w-4 mr-1" />Add customer</Button>}
      />

      <div className="px-4 sm:px-6 py-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 max-w-xl">
          <Card><CardContent className="p-4">
            <div className="text-xs text-gray-500">Owed to you</div>
            <div className="text-xl font-semibold text-rose-600 dark:text-rose-400">{formatMoney(totalOwed, currency)}</div>
          </CardContent></Card>
          <Card><CardContent className="p-4">
            <div className="text-xs text-gray-500">Customers owing</div>
            <div className="text-xl font-semibold">{owingCount}</div>
          </CardContent></Card>
        </div>

        {showAdd && (
          <Card><CardContent className="p-4 space-y-3">
            <h2 className="text-base font-semibold">New customer</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Mama Njeri" aria-label="Customer name" />
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" aria-label="Customer phone" />
            </div>
            <Button onClick={addCustomer} disabled={adding || name.trim().length < 2}>{adding ? 'Adding…' : 'Add'}</Button>
          </CardContent></Card>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or phone" className="pl-9" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={onlyOwing} onChange={(e) => setOnlyOwing(e.target.checked)} />
            Only customers who owe
          </label>
        </div>

        <Card><CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-sm text-gray-400">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">
              {customers.length === 0
                ? 'No customers yet. Pick "Credit" as the payment when recording a sale, or add a customer here.'
                : onlyOwing ? 'Nobody owes anything right now.' : 'No customer matches that search.'}
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {shown.map((c) => (
                <li key={c.id}>
                  <Link href={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{c.name}</div>
                      <div className="text-xs text-gray-500 truncate">{c.phone || 'No phone'}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`font-semibold ${c.balance > 0 ? 'text-rose-600 dark:text-rose-400' : c.balance < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                        {c.balance > 0 ? formatMoney(c.balance, currency) : c.balance < 0 ? `${formatMoney(-c.balance, currency)} ahead` : 'Settled'}
                      </div>
                      <div className="text-xs text-gray-500">{c.balance > 0 ? 'owes' : ' '}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent></Card>
      </div>
    </>
  );
}
