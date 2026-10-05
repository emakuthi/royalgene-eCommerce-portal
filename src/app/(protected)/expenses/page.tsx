'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useHydratedAuth } from '@/lib/hooks';
import { useBranding } from '@/lib/branding-context';
import { formatMoney } from '@/lib/currency';
import { toast } from 'sonner';
import PortalHeader from '@/components/portal/PortalHeader';
import { Trash2, Plus, Download, Play, Repeat } from 'lucide-react';

interface Category { id: string; name: string; isActive: boolean }
interface Shop { id: string; name: string }
interface Expense {
  id: string; shopId: string | null; categoryId: string | null; categoryName: string | null;
  amount: number; currency: string; baseAmount: number; description: string | null; expenseDate: string;
}
type Frequency = 'daily' | 'weekly' | 'monthly';
interface Recurring {
  id: string; shopId: string | null; categoryId: string | null; categoryName: string | null;
  amount: number; currency: string; description: string | null;
  frequency: Frequency; interval: number; nextRunDate: string; endDate: string | null;
  isActive: boolean; lastGeneratedDate: string | null;
}

export default function ExpensesPage() {
  const { token } = useHydratedAuth();
  const base = useBranding().branding.currency;

  const [categories, setCategories] = useState<Category[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([base]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // add form
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(base);
  const [categoryId, setCategoryId] = useState('');
  const [shopId, setShopId] = useState('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  // Recurring templates
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [rFrequency, setRFrequency] = useState<Frequency>('monthly');
  const [rInterval, setRInterval] = useState('1');
  const [rStartDate, setRStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [rEndDate, setREndDate] = useState('');
  const [rSaving, setRSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const authHeaders = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [cats, shopsRes, curRes, exp, rec] = await Promise.all([
        fetch('/api/portal/expense-categories?activeOnly=1', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
        fetch('/api/portal/shops', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
        fetch('/api/currencies/active', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
        fetch('/api/portal/expenses', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
        fetch('/api/portal/recurring-expenses', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
      ]);
      if (cats?.success) setCategories(cats.data ?? []);
      if (shopsRes?.success) setShops((shopsRes.data ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
      if (curRes?.success) setCurrencies((curRes.data ?? []).map((c: { code: string }) => c.code));
      if (exp?.success) setExpenses(exp.data ?? []);
      if (rec?.success) setRecurring(rec.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [token, authHeaders]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function addExpense() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/portal/expenses', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ amount: amt, currency, categoryId: categoryId || undefined, shopId: shopId || undefined, description: description || undefined, expenseDate }),
      });
      const j = await res.json();
      if (j?.success) {
        toast.success('Expense recorded');
        setAmount(''); setDescription('');
        await loadAll();
      } else {
        toast.error(j?.error || 'Failed to record expense');
      }
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    const res = await fetch('/api/portal/expense-categories', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ name }) });
    const j = await res.json();
    if (j?.success) { setNewCategory(''); setCategoryId(j.data.id); await loadAll(); }
    else toast.error(j?.error || 'Failed to add category');
  }

  async function removeExpense(id: string) {
    const res = await fetch(`/api/portal/expenses/${id}`, { method: 'DELETE', headers: authHeaders() });
    const j = await res.json().catch(() => ({}));
    if (j?.success) { setExpenses(prev => prev.filter(e => e.id !== id)); toast.success('Expense deleted'); }
    else toast.error('Failed to delete');
  }

  async function exportCsv() {
    try {
      const res = await fetch('/api/portal/expenses/export', { headers: authHeaders() });
      if (!res.ok) { toast.error('Export failed'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { toast.error('Export failed'); }
  }

  async function addRecurring() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { toast.error('Enter a valid amount above first'); return; }
    setRSaving(true);
    try {
      const res = await fetch('/api/portal/recurring-expenses', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          amount: amt, currency, categoryId: categoryId || undefined, shopId: shopId || undefined,
          description: description || undefined, frequency: rFrequency, interval: Number(rInterval) || 1,
          startDate: rStartDate, endDate: rEndDate || undefined,
        }),
      });
      const j = await res.json();
      if (j?.success) { toast.success('Recurring expense scheduled'); await loadAll(); }
      else toast.error(j?.error || 'Failed to schedule');
    } finally { setRSaving(false); }
  }

  async function toggleRecurring(r: Recurring) {
    const res = await fetch(`/api/portal/recurring-expenses/${r.id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ isActive: !r.isActive }) });
    const j = await res.json().catch(() => ({}));
    if (j?.success) setRecurring(prev => prev.map(x => x.id === r.id ? { ...x, isActive: !r.isActive } : x));
    else toast.error('Failed to update');
  }

  async function removeRecurring(id: string) {
    const res = await fetch(`/api/portal/recurring-expenses/${id}`, { method: 'DELETE', headers: authHeaders() });
    const j = await res.json().catch(() => ({}));
    if (j?.success) { setRecurring(prev => prev.filter(r => r.id !== id)); toast.success('Recurring expense removed'); }
    else toast.error('Failed to remove');
  }

  async function runDueNow() {
    setRunning(true);
    try {
      const res = await fetch('/api/portal/recurring-expenses/run', { method: 'POST', headers: authHeaders() });
      const j = await res.json();
      if (j?.success) { toast.success(`Generated ${j.data?.generated ?? 0} expense(s)`); await loadAll(); }
      else toast.error('Failed to run');
    } finally { setRunning(false); }
  }

  const totalBase = expenses.reduce((s, e) => s + (e.baseAmount || 0), 0);
  const shopName = (id: string | null) => (id ? shops.find(s => s.id === id)?.name ?? '—' : 'All shops');
  const freqLabel = (r: Recurring) => {
    const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[r.frequency];
    return r.interval > 1 ? `every ${r.interval} ${unit}s` : ({ daily: 'daily', weekly: 'weekly', monthly: 'monthly' } as const)[r.frequency];
  };

  return (
    <>
      <PortalHeader backHref="/dashboard" title="Expenses" description="Record operating expenses — used for Net Profit" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Expenses' }]} />

      <div className="px-4 sm:px-6 py-4 space-y-6">
        {/* Add expense */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="text-lg font-semibold">Record an expense</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <div className="flex gap-2">
                  <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="flex-1" />
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className="shrink-0 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 text-sm">
                    {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-2 text-sm">
                  <option value="">— none —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Shop (optional)</label>
                <select value={shopId} onChange={e => setShopId(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-2 text-sm">
                  <option value="">All shops (org-wide)</option>
                  {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <Input type="date" value={expenseDate} onChange={e => setExpenseDate(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Description</label>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g. October rent" />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button onClick={addExpense} disabled={saving} className="w-full sm:w-auto bg-[hsl(var(--primary))] text-white">{saving ? 'Saving…' : 'Add Expense'}</Button>
              <span className="hidden sm:inline text-gray-300">|</span>
              <div className="flex items-center gap-2">
                <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="New category" className="flex-1 sm:flex-none sm:w-40" />
                <Button variant="outline" size="sm" onClick={addCategory} className="shrink-0"><Plus className="h-3.5 w-3.5 mr-1" />Add category</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recurring expenses */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Repeat className="h-4 w-4" />Recurring expenses</h2>
              <Button variant="outline" size="sm" onClick={runDueNow} disabled={running}><Play className="h-3.5 w-3.5 mr-1" />{running ? 'Running…' : 'Run due now'}</Button>
            </div>
            <p className="text-xs text-gray-500">
              Uses the amount, currency, category and shop from the form above. Each run records a real expense automatically (daily), freezing the exchange rate at that moment.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Frequency</label>
                <select value={rFrequency} onChange={e => setRFrequency(e.target.value as Frequency)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-2 text-sm">
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Every</label>
                <Input type="number" min="1" step="1" value={rInterval} onChange={e => setRInterval(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Starts</label>
                <Input type="date" value={rStartDate} onChange={e => setRStartDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Ends (optional)</label>
                <Input type="date" value={rEndDate} onChange={e => setREndDate(e.target.value)} />
              </div>
            </div>
            <Button onClick={addRecurring} disabled={rSaving} variant="outline" size="sm"><Plus className="h-3.5 w-3.5 mr-1" />{rSaving ? 'Scheduling…' : 'Schedule recurring'}</Button>

            {recurring.length > 0 && (
              <>
              <ul className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
                {recurring.map(r => (
                  <li key={r.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{formatMoney(r.amount, r.currency)} <span className="text-xs font-normal text-gray-500">· {freqLabel(r)}</span></div>
                      <div className="text-xs text-gray-500 truncate">{r.categoryName ?? 'No category'} · {shopName(r.shopId)}</div>
                      <div className="text-xs text-gray-500">Next run: {r.isActive ? r.nextRunDate : '—'}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => toggleRecurring(r)} className={`text-xs rounded-full px-2 py-0.5 ${r.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
                        {r.isActive ? 'Active' : 'Paused'}
                      </button>
                      <button onClick={() => removeRecurring(r.id)} aria-label="Remove recurring expense" className="text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-gray-500">
                    <tr><th className="py-2">Amount</th><th>Category</th><th>Shop</th><th>Schedule</th><th>Next run</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {recurring.map(r => (
                      <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2 whitespace-nowrap">{formatMoney(r.amount, r.currency)}</td>
                        <td>{r.categoryName ?? '—'}</td>
                        <td>{shopName(r.shopId)}</td>
                        <td className="whitespace-nowrap">{freqLabel(r)}</td>
                        <td className="whitespace-nowrap">{r.isActive ? r.nextRunDate : '—'}</td>
                        <td>
                          <button onClick={() => toggleRecurring(r)} className={`text-xs rounded-full px-2 py-0.5 ${r.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}>
                            {r.isActive ? 'Active' : 'Paused'}
                          </button>
                        </td>
                        <td><button onClick={() => removeRecurring(r.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* List */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold">Recent expenses</h2>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500">Total: <strong>{formatMoney(totalBase, base)}</strong></span>
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={expenses.length === 0}><Download className="h-3.5 w-3.5 mr-1" />Export CSV</Button>
              </div>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
            ) : expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No expenses recorded yet.</p>
            ) : (
              <>
              <ul className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
                {expenses.map(e => (
                  <li key={e.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {formatMoney(e.amount, e.currency)}
                        {e.currency !== base && <span className="text-xs font-normal text-gray-500"> ≈ {formatMoney(e.baseAmount, base)}</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{e.expenseDate} · {e.categoryName ?? 'No category'} · {shopName(e.shopId)}</div>
                      {e.description && <div className="text-sm truncate">{e.description}</div>}
                    </div>
                    <button onClick={() => removeExpense(e.id)} aria-label="Delete expense" className="shrink-0 text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-gray-500">
                    <tr><th className="py-2">Date</th><th>Category</th><th>Shop</th><th>Amount</th><th>In {base}</th><th>Description</th><th></th></tr>
                  </thead>
                  <tbody>
                    {expenses.map(e => (
                      <tr key={e.id} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-2 whitespace-nowrap">{e.expenseDate}</td>
                        <td>{e.categoryName ?? '—'}</td>
                        <td>{shopName(e.shopId)}</td>
                        <td className="whitespace-nowrap">{formatMoney(e.amount, e.currency)}</td>
                        <td className="whitespace-nowrap">{e.currency === base ? '—' : formatMoney(e.baseAmount, base)}</td>
                        <td className="max-w-[16rem] truncate">{e.description ?? ''}</td>
                        <td><button onClick={() => removeExpense(e.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
