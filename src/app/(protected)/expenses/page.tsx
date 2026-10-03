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
import { Trash2, Plus } from 'lucide-react';

interface Category { id: string; name: string; isActive: boolean }
interface Shop { id: string; name: string }
interface Expense {
  id: string; shopId: string | null; categoryId: string | null; categoryName: string | null;
  amount: number; currency: string; baseAmount: number; description: string | null; expenseDate: string;
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

  const authHeaders = useCallback(() => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }), [token]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [cats, shopsRes, curRes, exp] = await Promise.all([
        fetch('/api/portal/expense-categories?activeOnly=1', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
        fetch('/api/portal/shops', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
        fetch('/api/currencies/active', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
        fetch('/api/portal/expenses', { headers: authHeaders() }).then(r => r.json()).catch(() => ({})),
      ]);
      if (cats?.success) setCategories(cats.data ?? []);
      if (shopsRes?.success) setShops((shopsRes.data ?? []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })));
      if (curRes?.success) setCurrencies((curRes.data ?? []).map((c: { code: string }) => c.code));
      if (exp?.success) setExpenses(exp.data ?? []);
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

  const totalBase = expenses.reduce((s, e) => s + (e.baseAmount || 0), 0);
  const shopName = (id: string | null) => (id ? shops.find(s => s.id === id)?.name ?? '—' : 'All shops');

  return (
    <>
      <PortalHeader backHref="/dashboard" title="Expenses" description="Record operating expenses — used for Net Profit" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Expenses' }]} />

      <div className="px-4 sm:px-6 py-4 space-y-6">
        {/* Add expense */}
        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-semibold">Record an expense</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Amount</label>
                <div className="flex gap-2">
                  <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" className="flex-1" />
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className="rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 text-sm">
                    {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 text-sm">
                  <option value="">— none —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Shop (optional)</label>
                <select value={shopId} onChange={e => setShopId(e.target.value)} className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-2 text-sm">
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
            <div className="flex items-center gap-2">
              <Button onClick={addExpense} disabled={saving} className="bg-[hsl(var(--primary))] text-white">{saving ? 'Saving…' : 'Add Expense'}</Button>
              <span className="text-gray-300">|</span>
              <Input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="New category" className="w-40 h-9" />
              <Button variant="outline" size="sm" onClick={addCategory}><Plus className="h-3.5 w-3.5 mr-1" />Add category</Button>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Recent expenses</h2>
              <span className="text-sm text-gray-500">Total: <strong>{formatMoney(totalBase, base)}</strong></span>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
            ) : expenses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No expenses recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
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
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
