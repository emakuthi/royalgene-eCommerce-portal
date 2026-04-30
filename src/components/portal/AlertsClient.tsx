'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useHydratedAuth } from '@/lib/hooks';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import MuiButton from '@mui/material/Button';

export type AlertItem = {
  id: string;
  title?: string;
  message?: string;
  createdAt?: string;
  level?: string;
  read?: boolean;
};

export default function AlertsClient({
  initialAlerts = [],
  initialTotal = null,
  initialPage = 1,
  pageSize = 10,
}: {
  initialAlerts?: AlertItem[];
  initialTotal?: number | null;
  initialPage?: number;
  pageSize?: number;
}) {
  const { token, mounted } = useHydratedAuth();
  const [loading, setLoading] = useState(false);
  const [alerts, setAlerts] = useState<AlertItem[]>(initialAlerts);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState<number | null>(initialTotal);
  const [deleteAlertTarget, setDeleteAlertTarget] = useState<string | null>(null);

  useEffect(() => {
    // when page changes, fetch client-side (skip first load if page === initialPage and initialAlerts provided)
    if (!mounted) return;
    const fetchPage = async () => {
      setLoading(true);
      setError(null);
      try {
        const offset = (page - 1) * pageSize;
        const res = await fetch(`/api/portal/alerts?limit=${pageSize}&offset=${offset}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          cache: 'no-store',
        });
        if (!res.ok) {
          setError(`Server returned ${res.status}`);
          setAlerts([]);
          setTotal(null);
          setLoading(false);
          return;
        }
        const json = await res.json();
        if (!json?.success) {
          setError(json?.message || 'Failed to load alerts');
          setAlerts([]);
          setTotal(null);
        } else {
          setAlerts(Array.isArray(json.data) ? json.data : []);
          setTotal(typeof json.total === 'number' ? json.total : (Array.isArray(json.data) ? json.data.length : 0));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg || 'Unknown error');
        setAlerts([]);
        setTotal(null);
      } finally {
        setLoading(false);
      }
    };

    // if initial data exists and page is initialPage, skip fetch
    if (page === initialPage && initialAlerts.length > 0) return;
    void fetchPage();
  }, [page, pageSize, token, mounted, initialPage, initialAlerts.length]);

  const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const acknowledgeAlert = async (id: string) => {
    const prev = alerts;
    setAlerts((a) => a.map((x) => (x.id === id ? { ...x, read: true } : x)));
    setError(null);
    try {
      const res = await fetch(`/api/portal/alerts/${id}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`Server returned ${res.status}`);
        setAlerts(prev);
        return;
      }
      const json = await res.json();
      if (!json?.success) {
        setError(json?.message || 'Failed to acknowledge');
        setAlerts(prev);
        return;
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setAlerts(prev);
    }
  };

  const deleteAlert = async (id: string) => {
    setDeleteAlertTarget(id);
  };

  const confirmDeleteAlert = async () => {
    const id = deleteAlertTarget;
    if (!id) return;
    setDeleteAlertTarget(null);
    const prev = alerts;
    setAlerts((a) => a.filter((x) => x.id !== id));
    setError(null);
    try {
      const res = await fetch(`/api/portal/alerts/${id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`Server returned ${res.status}`);
        setAlerts(prev);
        return;
      }
      const json = await res.json();
      if (!json?.success) {
        setError(json?.message || 'Failed to delete');
        setAlerts(prev);
        return;
      }
      setTotal((t) => (typeof t === 'number' ? Math.max(0, t - 1) : t));
    } catch (err) {
      setError(getErrorMessage(err));
      setAlerts(prev);
    }
  };

  const markAllRead = async () => {
    const prev = alerts;
    setAlerts((a) => a.map((x) => ({ ...x, read: true })));
    setError(null);
    try {
      const res = await fetch('/api/portal/alerts/acknowledge-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: 'no-store',
      });
      if (!res.ok) {
        setError(`Server returned ${res.status}`);
        setAlerts(prev);
        return;
      }
      const json = await res.json();
      if (!json?.success) {
        setError(json?.message || 'Failed to mark all read');
        setAlerts(prev);
        return;
      }
    } catch (err) {
      setError(getErrorMessage(err));
      setAlerts(prev);
    }
  };

  const totalPages = total ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return (
    <div className="flex flex-col min-h-0 bg-transparent">
      <div className="sticky top-0 z-30 bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700 px-2 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Alerts</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">Recent system alerts and notifications for your portal</p>
          </div>

          <div className="ml-4 flex items-center gap-3">
            <button onClick={() => setPage(1)} disabled={page === 1} className="px-3 py-1 bg-white border rounded text-sm disabled:opacity-50">First</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-white border rounded text-sm disabled:opacity-50">Prev</button>

            <div className="text-sm text-gray-600">Page {page} of {totalPages}</div>

            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 bg-white border rounded text-sm disabled:opacity-50">Next</button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="px-3 py-1 bg-white border rounded text-sm disabled:opacity-50">Last</button>

            <Link href="/alerts/new"><button className="px-3 py-1 bg-[hsl(var(--primary))] text-white rounded text-sm">New Alert</button></Link>

            <button onClick={markAllRead} className="px-3 py-1 bg-emerald-600 text-white rounded text-sm">Mark all read</button>
          </div>
        </div>
      </div>

      <div className="p-4 overflow-auto flex-1">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse p-3 bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700 rounded">
                <div className="h-4 bg-gray-200 dark:bg-zinc-700 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-200 dark:bg-zinc-700 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-600">Error: {error}</div>
        ) : alerts.length === 0 ? (
          <div className="text-sm text-gray-600">No alerts found.</div>
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className={`p-3 bg-white dark:bg-zinc-800 border ${a.read ? 'border-gray-100 dark:border-zinc-700' : 'border-blue-300'} rounded`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      {!a.read && <span className="inline-block h-2 w-2 rounded-full bg-blue-500" aria-hidden />}
                      <div className="text-sm font-medium text-gray-900 dark:text-white">{a.title ?? 'Alert'}</div>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{a.message}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400">{a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}</div>
                    <div className="flex items-center gap-2">
                      {!a.read && (
                        <button onClick={() => void acknowledgeAlert(a.id)} className="text-sm px-2 py-1 bg-sky-600 text-white rounded">Mark read</button>
                      )}
                      <button onClick={() => void deleteAlert(a.id)} className="text-sm px-2 py-1 bg-rose-600 text-white rounded">Delete</button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sticky bottom-0 bg-gray-50 dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-700 p-3">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div>Showing {(page - 1) * pageSize + 1} - {Math.min(total ?? alerts.length, page * pageSize)} of {total ?? alerts.length}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-white border rounded text-sm disabled:opacity-50">Prev</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 bg-white border rounded text-sm disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>

      {/* Delete Alert Confirmation Modal */}
      <Dialog open={Boolean(deleteAlertTarget)} onClose={() => setDeleteAlertTarget(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>🗑️ Delete Alert</DialogTitle>
        <DialogContent>
          <DialogContentText>Are you sure you want to delete this alert? This action cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <MuiButton onClick={() => setDeleteAlertTarget(null)} variant="outlined" size="small">Cancel</MuiButton>
          <MuiButton onClick={() => void confirmDeleteAlert()} variant="contained" size="small" sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>Delete</MuiButton>
        </DialogActions>
      </Dialog>
    </div>
  );
}

