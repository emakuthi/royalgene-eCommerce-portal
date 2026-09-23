'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useHydratedAuth } from '@/lib/hooks';
import { toast } from 'sonner';
import { ArchiveRestore, Trash2, AlertTriangle } from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';
import { useTheme } from '@/lib/theme-context';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import MuiButton from '@mui/material/Button';

interface TrashedSale {
  id: string;
  shopId: string;
  shopName: string | null;
  productId: string;
  productName: string | null;
  size: string | null;
  color: string | null;
  quantity: number;
  totalAmount: number;
  entryDate: string;
  deletedAt: string;
  purgeEligibleAt: string;
}

function formatCurrency(amount: number) {
  return amount.toFixed(2);
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function SalesTrashContent() {
  const { theme } = useTheme();
  const { token, user: authUser } = useHydratedAuth();
  const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';

  const bgPrimary = theme === 'dark' ? 'bg-black' : 'bg-gray-50';
  const textPrimary = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const borderColor = theme === 'dark' ? 'border-gray-800' : 'border-gray-200';

  const [mounted, setMounted] = useState(false);
  const [sales, setSales] = useState<TrashedSale[]>([]);
  const [retentionDays, setRetentionDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [purging, setPurging] = useState(false);

  useEffect(() => setMounted(true), []);

  const fetchTrash = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch('/api/portal/sales/trash', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (res.ok && json.success) {
        setSales(json.data.sales || []);
        setRetentionDays(json.data.retentionDays ?? 90);
      } else {
        toast.error(json.error || 'Failed to load deleted sales');
      }
    } catch (err) {
      console.error('Failed to fetch sales trash', err);
      toast.error('Failed to load deleted sales');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (mounted) void fetchTrash(); }, [mounted, fetchTrash]);

  const restore = async (id: string) => {
    setRestoringId(id);
    try {
      const res = await fetch('/api/portal/sales/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        toast.error(json.error || 'Failed to restore sale');
        return;
      }
      setSales(prev => prev.filter(s => s.id !== id));
      toast.success('Sale restored');
    } catch (err) {
      console.error('Restore sale error', err);
      toast.error('Failed to restore sale');
    } finally {
      setRestoringId(null);
    }
  };

  const emptyTrash = async () => {
    setConfirmPurge(false);
    setPurging(true);
    try {
      const res = await fetch('/api/portal/sales/trash/purge', {
        method: 'POST',
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        toast.error(json.error || 'Failed to empty trash');
        return;
      }
      toast.success(json.message || `${json.data?.purged ?? 0} permanently removed`);
      void fetchTrash();
    } catch (err) {
      console.error('Empty trash error', err);
      toast.error('Failed to empty trash');
    } finally {
      setPurging(false);
    }
  };

  const eligibleNow = sales.filter(s => daysUntil(s.purgeEligibleAt) <= 0).length;

  if (!mounted) return null;

  if (!isAdmin) {
    return (
      <div className={`${bgPrimary} w-full min-h-screen flex items-center justify-center`}>
        <p className={textSecondary}>Only workspace admins can view deleted sales.</p>
      </div>
    );
  }

  return (
    <div className={`${bgPrimary} w-full`}>
      <PortalHeader
        backHref="/sales"
        title="Sales Trash"
        description={`Deleted sales stay recoverable for ${retentionDays} days before they're permanently removed`}
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Sales', href: '/sales' }, { label: 'Trash' }]}
        actions={(
          <Button
            variant="destructive"
            className="flex items-center gap-2"
            onClick={() => setConfirmPurge(true)}
            disabled={purging || eligibleNow === 0}
          >
            <Trash2 className="h-4 w-4" />
            <span className="text-sm">Empty Trash{eligibleNow > 0 ? ` (${eligibleNow})` : ''}</span>
          </Button>
        )}
      />

      <div className="px-2 sm:px-2 pb-6 w-full pt-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArchiveRestore className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <div>
                <CardTitle>Deleted Sales</CardTitle>
                <CardDescription>Restore one, or wait for it to age past {retentionDays} days and empty the trash</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
                ))}
              </div>
            ) : sales.length === 0 ? (
              <div className={`text-center py-12 ${textSecondary}`}>
                <ArchiveRestore className="h-10 w-10 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Nothing in the trash right now.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className={`text-xs font-semibold ${textSecondary} border-b-2 ${borderColor}`}>
                      <th className="py-3 px-2 text-left">Product</th>
                      <th className="py-3 px-2 text-left">Shop</th>
                      <th className="py-3 px-2 text-center">Qty</th>
                      <th className="py-3 px-2 text-right">Amount</th>
                      <th className="py-3 px-2 text-left">Deleted</th>
                      <th className="py-3 px-2 text-left">Purge eligible</th>
                      <th className="py-3 px-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sales.map((s, idx) => {
                      const daysLeft = daysUntil(s.purgeEligibleAt);
                      const variant = [s.size, s.color].filter(Boolean).join(' / ');
                      return (
                        <tr key={s.id} className={`border-b ${borderColor} ${idx % 2 === 0 ? (theme === 'dark' ? 'bg-gray-900 bg-opacity-30' : 'bg-gray-50 bg-opacity-50') : ''}`}>
                          <td className={`py-3 px-2 text-sm ${textPrimary}`}>
                            {s.productName || 'Unknown product'}
                            {variant && <span className={`block text-xs ${textSecondary}`}>{variant}</span>}
                          </td>
                          <td className={`py-3 px-2 text-sm ${textSecondary}`}>{s.shopName || '—'}</td>
                          <td className={`py-3 px-2 text-sm text-center ${textPrimary}`}>{s.quantity}</td>
                          <td className={`py-3 px-2 text-sm text-right font-medium ${textPrimary}`}>{formatCurrency(s.totalAmount)}</td>
                          <td className={`py-3 px-2 text-xs ${textSecondary}`}>{new Date(s.deletedAt).toLocaleDateString()}</td>
                          <td className="py-3 px-2 text-xs">
                            {daysLeft <= 0 ? (
                              <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                                <AlertTriangle className="h-3.5 w-3.5" />Eligible now
                              </span>
                            ) : (
                              <span className={textSecondary}>in {daysLeft} day{daysLeft === 1 ? '' : 's'}</span>
                            )}
                          </td>
                          <td className="py-3 px-2 text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5"
                              onClick={() => void restore(s.id)}
                              disabled={restoringId === s.id}
                            >
                              <ArchiveRestore className="h-3.5 w-3.5" />
                              {restoringId === s.id ? 'Restoring…' : 'Restore'}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Empty Trash confirmation */}
      <Dialog open={confirmPurge} onClose={() => !purging && setConfirmPurge(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>🗑️ Empty trash?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently erases every deleted sale past its {retentionDays}-day window ({eligibleNow} right now). This can’t be undone — anything still within the window is left alone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <MuiButton onClick={() => setConfirmPurge(false)} variant="outlined" size="small" disabled={purging}>Cancel</MuiButton>
          <MuiButton onClick={() => void emptyTrash()} variant="contained" size="small" disabled={purging} sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>{purging ? 'Emptying…' : 'Empty Trash'}</MuiButton>
        </DialogActions>
      </Dialog>
    </div>
  );
}

export default function SalesTrashPage() {
  return <SalesTrashContent />;
}
