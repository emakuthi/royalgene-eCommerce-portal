'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { disconnectDrive, getDriveConnectUrl, getDriveStatus, type DriveStatus } from '@/lib/receipts';

const RETURN_MESSAGES: Record<string, [kind: 'success' | 'error' | 'info', text: string]> = {
  connected: ['success', 'Google Drive connected. Receipts will be saved to "RoyalTrack Receipts".'],
  cancelled: ['info', 'Google Drive was not connected.'],
  no_drive_access: ['error', 'Google Drive was not connected: please allow RoyalTrack to create files in your Drive.'],
  error: ['error', 'Could not connect Google Drive. Please try again.'],
};

/** Settings → Integrations: connect the owner's Google Drive, where scanned purchase receipts are kept. */
export default function GoogleDriveSection({ token }: { token: string | null }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => { if (token) getDriveStatus(token).then((r) => r.success && r.data && setStatus(r.data)); };
  useEffect(load, [token]);

  // Back from Google's consent screen: say how it went once, then tidy the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('drive');
    if (!result) return;
    const [kind, text] = RETURN_MESSAGES[result] ?? RETURN_MESSAGES.error;
    toast[kind](text);
    params.delete('drive');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  }, []);

  const connect = async () => {
    setBusy(true);
    const res = await getDriveConnectUrl(token);
    if (res.success && res.data?.authorizationUrl) {
      window.location.href = res.data.authorizationUrl;
    } else {
      toast.error(res.error || 'Could not start the Google Drive connection');
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive? Receipts already saved stay in your Drive, but RoyalTrack can\'t show them or save new ones until you connect again.')) return;
    setBusy(true);
    const res = await disconnectDrive(token);
    setBusy(false);
    if (res.success) {
      toast.success('Google Drive disconnected');
      load();
    } else {
      toast.error(res.error || 'Could not disconnect Google Drive');
    }
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
      <div className="px-6 py-5 border-b border-[hsl(var(--border))]">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Google Drive (receipts)</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Scanned purchase receipts are saved to a &quot;RoyalTrack Receipts&quot; folder in your Google Drive. RoyalTrack can only see the files it saves there.
        </p>
      </div>
      <div className="px-6 py-5">
        {!status ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
        ) : !status.configured ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Google Drive isn&apos;t set up on this platform yet. Contact your platform administrator.</p>
        ) : status.connected ? (
          <div className="rounded-lg border border-[hsl(var(--border))] p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-white">Connected{status.email ? ` to ${status.email}` : ''}</p>
              {status.connectedAt && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Since {new Date(status.connectedAt).toLocaleDateString()}</p>
              )}
            </div>
            {status.canConnect && (
              <Button variant="outline" size="sm" disabled={busy} onClick={disconnect} className="text-red-600 hover:text-red-700">
                {busy ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            )}
          </div>
        ) : !status.canConnect ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Ask the workspace owner to connect Google Drive so receipts can be saved.</p>
        ) : (
          <div className="space-y-3">
            {status.needsReconnect && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Google stopped accepting RoyalTrack&apos;s access{status.email ? ` to ${status.email}` : ''}. Connect again to keep saving and viewing receipts.
              </p>
            )}
            <Button disabled={busy} onClick={connect}>
              {busy ? 'Redirecting…' : status.needsReconnect ? 'Reconnect Google Drive' : 'Connect Google Drive'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
