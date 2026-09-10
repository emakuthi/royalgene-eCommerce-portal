'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, KeyRound, Mail, MailCheck, Trash2, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  listOrganizationUsers,
  removeOrganizationUser,
  updateOrganizationUser,
  type PlatformOrgUser,
} from '@/lib/platform';

/**
 * Super-admin support panel: every login inside one tenant, with the
 * fix-it actions a customer-support conversation needs — correct a mistyped
 * email, confirm an address, issue a temporary password, cut mobile access,
 * or remove an account.
 */
export function TenantUsersPanel({
  token,
  orgId,
  orgName,
}: {
  token: string | null | undefined;
  orgId: string;
  orgName: string;
}) {
  const [users, setUsers] = useState<PlatformOrgUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState('');
  const [pwdForId, setPwdForId] = useState<string | null>(null);
  const [pwdDraft, setPwdDraft] = useState('');
  const [removeId, setRemoveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await listOrganizationUsers(token, orgId);
    if (res.ok && res.success) setUsers(res.data ?? []);
    else setError(res.error || 'Could not load logins');
  }, [token, orgId]);

  useEffect(() => { void load(); }, [load]);

  const patch = async (userId: string, body: Parameters<typeof updateOrganizationUser>[3], okMsg: string) => {
    setBusyId(userId);
    const res = await updateOrganizationUser(token, orgId, userId, body);
    setBusyId(null);
    if (res.ok && res.success && res.data) {
      setUsers((prev) => (prev ? prev.map((u) => (u.id === userId ? res.data! : u)) : prev));
      toast.success(okMsg);
      return true;
    }
    toast.error(res.error || 'Update failed');
    return false;
  };

  const saveEmail = async (userId: string) => {
    const email = emailDraft.trim().toLowerCase();
    if (!email) return;
    if (await patch(userId, { email }, 'Email updated')) setEditingId(null);
  };

  const savePassword = async (userId: string) => {
    if (pwdDraft.length < 8) { toast.error('Use at least 8 characters'); return; }
    if (await patch(userId, { password: pwdDraft }, 'Temporary password set — share it with the customer')) {
      setPwdForId(null);
      setPwdDraft('');
    }
  };

  const doRemove = async (userId: string) => {
    setBusyId(userId);
    const res = await removeOrganizationUser(token, orgId, userId);
    setBusyId(null);
    setRemoveId(null);
    if (res.ok && res.success) {
      setUsers((prev) => (prev ? prev.filter((u) => u.id !== userId) : prev));
      toast.success('Account removed');
    } else {
      toast.error(res.error || 'Could not remove');
    }
  };

  if (error) {
    return (
      <div className="text-sm text-red-600 dark:text-red-400">
        {error} <button className="underline" onClick={() => void load()}>Retry</button>
      </div>
    );
  }
  if (!users) return <p className="text-sm text-gray-500">Loading logins…</p>;
  if (users.length === 0) return <p className="text-sm text-gray-500">No user accounts in {orgName}.</p>;

  return (
    <div className="space-y-2">
      {users.map((u) => {
        const busy = busyId === u.id;
        const anyMobile = u.memberships.some((m) => m.mobileAccess);
        const hasMemberships = u.memberships.length > 0;
        return (
          <div key={u.id} className="rounded-lg border border-gray-200 dark:border-gray-800 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{u.name || '—'}</span>
                  <Badge variant="secondary" className="text-[10px] uppercase">{u.role.replace('_', ' ')}</Badge>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      u.emailVerified
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                    }`}
                  >
                    {u.emailVerified ? 'verified' : 'unverified'}
                  </span>
                </div>

                {editingId === u.id ? (
                  <div className="flex gap-2 mt-1.5">
                    <Input
                      autoFocus
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      className="h-8 flex-1"
                      type="email"
                    />
                    <Button size="sm" className="h-8" disabled={busy} onClick={() => void saveEmail(u.id)}>Save</Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <button
                    className="mt-0.5 flex items-center gap-1.5 text-gray-600 dark:text-gray-300 hover:text-[hsl(var(--primary))]"
                    onClick={() => { setEditingId(u.id); setEmailDraft(u.email); }}
                    title="Edit login email"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    <span className="truncate">{u.email}</span>
                  </button>
                )}

                {hasMemberships && (
                  <p className="text-xs text-gray-400 mt-1">
                    {u.memberships.map((m) => m.shopName ?? 'no shop').join(', ')}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {!u.emailVerified && (
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0"
                    title="Mark email confirmed" disabled={busy}
                    onClick={() => void patch(u.id, { emailVerified: true }, 'Marked as verified')}
                  >
                    <MailCheck className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  size="sm" variant="ghost" className="h-8 w-8 p-0"
                  title="Set a temporary password" disabled={busy}
                  onClick={() => { setPwdForId(pwdForId === u.id ? null : u.id); setPwdDraft(''); }}
                >
                  <KeyRound className="h-4 w-4" />
                </Button>
                {hasMemberships && (
                  <Button
                    size="sm" variant="ghost"
                    className={`h-8 w-8 p-0 ${anyMobile ? 'text-emerald-600' : 'text-gray-400'}`}
                    title={anyMobile ? 'Disable mobile app access' : 'Enable mobile app access'}
                    disabled={busy}
                    onClick={() => void patch(u.id, { mobileAccess: !anyMobile }, anyMobile ? 'Mobile access disabled' : 'Mobile access enabled')}
                  >
                    <Smartphone className="h-4 w-4" />
                  </Button>
                )}
                {u.role !== 'super_admin' && (
                  <Button
                    size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-600"
                    title="Remove account" disabled={busy}
                    onClick={() => setRemoveId(u.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {pwdForId === u.id && (
              <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-gray-800">
                <Input
                  autoFocus
                  value={pwdDraft}
                  onChange={(e) => setPwdDraft(e.target.value)}
                  placeholder="New temporary password (8+ chars)"
                  className="h-8 flex-1"
                />
                <Button size="sm" className="h-8" disabled={busy} onClick={() => void savePassword(u.id)}>Set</Button>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setPwdForId(null)}>Cancel</Button>
              </div>
            )}

            {removeId === u.id && (
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-red-100 dark:border-red-900/40">
                <span className="text-xs text-red-600 dark:text-red-400">Permanently remove {u.email}?</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="destructive" className="h-8" disabled={busy} onClick={() => void doRemove(u.id)}>
                    Remove
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setRemoveId(null)}>Keep</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <p className="flex items-center gap-1.5 text-xs text-gray-400 pt-1">
        <CheckCircle2 className="h-3.5 w-3.5" /> Changes take effect immediately for the customer.
      </p>
    </div>
  );
}
