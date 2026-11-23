'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Pencil, Search, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PortalHeader from '@/components/portal/PortalHeader';
import ReceiptViewer from '@/components/receipts/ReceiptViewer';
import { useHydratedAuth } from '@/lib/hooks';
import { useBranding } from '@/lib/branding-context';
import { formatMoney } from '@/lib/currency';
import { businessDateKey } from '@/lib/business-time';
import {
  RECEIPT_ACCEPT, getDriveStatus, listReceipts, updateReceipt, uploadReceipt,
  type DriveStatus, type Receipt,
} from '@/lib/receipts';

interface Shop { id: string; name: string }

const select = 'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-2 text-sm';

/** Every purchase receipt in the workspace's Google Drive: search, filter, add, view, edit, remove. */
export default function ReceiptsPage() {
  const { token } = useHydratedAuth();
  const base = useBranding().branding.currency;

  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shopFilter, setShopFilter] = useState('');

  // add form
  const [file, setFile] = useState<File | null>(null);
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(businessDateKey());
  const [shopId, setShopId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [viewing, setViewing] = useState<Receipt | null>(null);
  const [editing, setEditing] = useState<Receipt | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const status = await getDriveStatus(token);
    if (status.success && status.data) setDrive(status.data);
    if (status.data?.canManageReceipts) {
      const res = await listReceipts(token, { q, from, to, shopId: shopFilter });
      if (res.success) setReceipts(res.data ?? []);
      else toast.error(res.error || 'Could not load receipts');
    }
    setLoading(false);
  }, [token, q, from, to, shopFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!token) return;
    fetch('/api/portal/shops', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(j => { if (j?.success) setShops((j.data ?? []).map((s: Shop) => ({ id: s.id, name: s.name }))); })
      .catch(() => {});
  }, [token]);

  async function addReceipt() {
    if (!file) { toast.error('Choose a photo or PDF of the receipt'); return; }
    if (amount && !(Number(amount) >= 0)) { toast.error('Enter a valid amount'); return; }
    setSaving(true);
    const res = await uploadReceipt(token, file, { supplier, amount, currency: base, receiptDate: date, notes, shopId });
    setSaving(false);
    if (!res.success) { toast.error(res.error || 'Could not save the receipt'); return; }
    toast.success('Receipt saved to Google Drive');
    setFile(null); setSupplier(''); setAmount(''); setNotes('');
    if (fileInput.current) fileInput.current.value = '';
    await load();
  }

  const shopName = (id: string | null) => (id ? shops.find(s => s.id === id)?.name ?? '—' : '—');
  const total = receipts.reduce((sum, r) => sum + (r.currency === base || !r.currency ? r.amount ?? 0 : 0), 0);
  const ready = drive?.canManageReceipts && drive.connected;

  return (
    <>
      <PortalHeader backHref="/dashboard" title="Receipts" description="Purchase receipts kept in your Google Drive" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Receipts' }]} />

      <div className="px-4 sm:px-6 py-4 space-y-6">
        {drive && !drive.canManageReceipts && (
          <Card><CardContent className="p-4 text-sm">You don&apos;t have permission to manage receipts. Ask the owner to turn on &quot;Manage receipts&quot; for your role.</CardContent></Card>
        )}
        {drive?.canManageReceipts && !drive.connected && (
          <Card>
            <CardContent className="p-4 text-sm">
              {drive.canConnect
                ? <>Connect Google Drive in <Link href="/settings?tab=integrations" className="underline">Settings → Integrations</Link> to start saving receipts.</>
                : 'The owner needs to connect Google Drive before receipts can be saved.'}
            </CardContent>
          </Card>
        )}

        {ready && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <h2 className="text-lg font-semibold">Add a receipt</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div className="md:col-span-2 lg:col-span-3">
                  <label className="block text-xs text-gray-500 mb-1">Photo or PDF (up to 10 MB)</label>
                  <input
                    ref={fileInput} type="file" accept={RECEIPT_ACCEPT}
                    onChange={e => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-gray-600 dark:text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 dark:file:bg-gray-800 file:px-3 file:py-1.5 file:text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Supplier</label>
                  <Input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="e.g. Naivas" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Total ({base})</label>
                  <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Shop (optional)</label>
                  <select value={shopId} onChange={e => setShopId(e.target.value)} className={select}>
                    <option value="">Not for one shop</option>
                    {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Notes</label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. 20 bags of sugar for Town shop" />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                To link a receipt to an expense, attach it on <Link href="/expenses" className="underline">Expenses</Link>; for a stock purchase, open the product in Inventory.
              </p>
              <Button onClick={addReceipt} disabled={saving} className="bg-[hsl(var(--primary))] text-white">
                <Upload className="h-4 w-4 mr-1.5" />{saving ? 'Saving…' : 'Save receipt'}
              </Button>
            </CardContent>
          </Card>
        )}

        {drive?.canManageReceipts && (
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs text-gray-500 mb-1">Search</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                    <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Supplier, notes or file name" className="pl-8" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">From</label>
                  <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">To</label>
                  <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
                </div>
                <div className="min-w-[10rem]">
                  <label className="block text-xs text-gray-500 mb-1">Shop</label>
                  <select value={shopFilter} onChange={e => setShopFilter(e.target.value)} className={select}>
                    <option value="">All shops</option>
                    {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Receipts</h2>
                <span className="text-sm text-gray-500">{receipts.length} · Total: <strong>{formatMoney(total, base)}</strong></span>
              </div>

              {loading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
              ) : receipts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No receipts match.</p>
              ) : (
                <>
                  <ul className="sm:hidden divide-y divide-gray-100 dark:divide-gray-800">
                    {receipts.map(r => (
                      <li key={r.id} className="py-3 flex items-start justify-between gap-3">
                        <button onClick={() => setViewing(r)} className="min-w-0 text-left">
                          <div className="font-medium truncate">{r.supplier || r.fileName}</div>
                          <div className="text-xs text-gray-500 truncate">
                            {[r.receiptDate, r.amount != null ? formatMoney(r.amount, r.currency ?? base) : null, r.linkLabel, shopName(r.shopId) !== '—' ? shopName(r.shopId) : null].filter(Boolean).join(' · ')}
                          </div>
                        </button>
                        <button onClick={() => setEditing(r)} aria-label="Edit receipt details" className="shrink-0 text-gray-400 hover:text-[hsl(var(--primary))]"><Pencil className="h-4 w-4" /></button>
                      </li>
                    ))}
                  </ul>
                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-gray-500">
                        <tr><th className="py-2">Date</th><th>Supplier</th><th>Amount</th><th>For</th><th>Shop</th><th>Notes</th><th></th></tr>
                      </thead>
                      <tbody>
                        {receipts.map(r => (
                          <tr key={r.id} className="border-t border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer" onClick={() => setViewing(r)}>
                            <td className="py-2 whitespace-nowrap">{r.receiptDate ?? '—'}</td>
                            <td className="max-w-[12rem] truncate">{r.supplier || <span className="text-gray-400">{r.fileName}</span>}</td>
                            <td className="whitespace-nowrap">{r.amount != null ? formatMoney(r.amount, r.currency ?? base) : '—'}</td>
                            <td className="max-w-[12rem] truncate">
                              {r.expenseId ? <span>Expense: {r.linkLabel}</span> : r.productId ? <span>Stock: {r.linkLabel}</span> : '—'}
                            </td>
                            <td>{shopName(r.shopId)}</td>
                            <td className="max-w-[14rem] truncate">{r.notes ?? ''}</td>
                            <td>
                              <button onClick={e => { e.stopPropagation(); setEditing(r); }} aria-label="Edit receipt details" className="text-gray-400 hover:text-[hsl(var(--primary))]"><Pencil className="h-4 w-4" /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {viewing && (
        <ReceiptViewer
          token={token}
          receipts={[viewing]}
          onClose={() => setViewing(null)}
          onDeleted={id => { setReceipts(prev => prev.filter(r => r.id !== id)); setViewing(null); }}
        />
      )}
      {editing && (
        <EditReceiptDialog
          receipt={editing}
          shops={shops}
          onClose={() => setEditing(null)}
          onSave={async fields => {
            const res = await updateReceipt(token, editing.id, fields);
            if (!res.success || !res.data) { toast.error(res.error || 'Could not save'); return; }
            const saved = res.data;
            setReceipts(prev => prev.map(r => r.id === saved.id ? { ...saved, linkLabel: r.linkLabel } : r));
            setEditing(null);
            toast.success('Receipt updated');
          }}
        />
      )}
    </>
  );
}

function EditReceiptDialog({
  receipt, shops, onClose, onSave,
}: {
  receipt: Receipt;
  shops: Shop[];
  onClose: () => void;
  onSave: (fields: { supplier: string | null; amount: number | null; receiptDate: string | null; notes: string | null; shopId: string | null }) => Promise<void>;
}) {
  const [supplier, setSupplier] = useState(receipt.supplier ?? '');
  const [amount, setAmount] = useState(receipt.amount != null ? String(receipt.amount) : '');
  const [date, setDate] = useState(receipt.receiptDate ?? '');
  const [notes, setNotes] = useState(receipt.notes ?? '');
  const [shopId, setShopId] = useState(receipt.shopId ?? '');
  const [saving, setSaving] = useState(false);

  return (
    <Dialog open onOpenChange={o => !o && onClose()} fullWidth maxWidth="sm">
      <DialogContent>
        <DialogHeader><DialogTitle sx={{ px: 0 }}>Receipt details</DialogTitle></DialogHeader>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Supplier</label>
            <Input value={supplier} onChange={e => setSupplier(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Total</label>
            <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Shop</label>
            <select value={shopId} onChange={e => setShopId(e.target.value)} className={select}>
              <option value="">Not for one shop</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Notes</label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={saving || (amount !== '' && !(Number(amount) >= 0))}
            onClick={async () => {
              setSaving(true);
              await onSave({
                supplier: supplier.trim() || null,
                amount: amount === '' ? null : Number(amount),
                receiptDate: date || null,
                notes: notes.trim() || null,
                shopId: shopId || null,
              });
              setSaving(false);
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
