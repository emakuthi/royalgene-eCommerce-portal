'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { getPermissionsMatrix, setPermission, type PermissionsData, type EditableRole, type Capability } from '@/lib/permissions';

const ROLE_LABELS: Record<EditableRole, string> = {
  shop_manager: 'Shop Manager',
  shopkeeper: 'Shopkeeper',
  cashier: 'Cashier',
  assistant: 'Assistant',
};

/**
 * Settings -> Permissions tab. Admin (JWT role) and the shop_owner position
 * always have every capability — see permissions.server.ts — so this only
 * ever edits the four "staff" roles below them. Each toggle upserts a
 * single override immediately (no separate Save step), same interaction as
 * a settings switch elsewhere in this page.
 */
export default function PermissionsTab({ token }: { token: string | null | undefined }) {
  const [data, setData] = useState<PermissionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const res = await getPermissionsMatrix(token);
      if (cancelled) return;
      if (res.ok && res.success && res.data) {
        setData(res.data);
        setError(null);
      } else {
        setError(res.error || 'Could not load permissions');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function toggle(role: EditableRole, capability: Capability, current: boolean) {
    if (!data) return;
    const cellKey = `${role}:${capability}`;
    setBusyCell(cellKey);
    // Optimistic — flip it locally, then reconcile with the server's response.
    setData({ ...data, matrix: { ...data.matrix, [role]: { ...data.matrix[role], [capability]: !current } } });
    const res = await setPermission(token, role, capability, !current);
    if (res.ok && res.success && res.data) {
      setData((prev) => (prev ? { ...prev, matrix: res.data!.matrix } : prev));
    } else {
      // Revert on failure.
      setData((prev) => (prev ? { ...prev, matrix: { ...prev.matrix, [role]: { ...prev.matrix[role], [capability]: current } } } : prev));
      toast.error(res.error || 'Could not update permission');
    }
    setBusyCell(null);
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[hsl(var(--border))] p-10 flex items-center justify-center text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading permissions…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[hsl(var(--border))] p-10 text-center text-sm text-red-500">
        {error || 'Could not load permissions'}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
      <div className="px-6 py-5 border-b border-[hsl(var(--border))] flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-[hsl(var(--primary))] mt-0.5 shrink-0" />
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Role Permissions</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Control what each staff role can do. The workspace admin and any shop owner always have full access and aren&apos;t shown here.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))]">
              <th className="text-left font-medium text-gray-500 dark:text-gray-400 px-6 py-3 whitespace-nowrap">Capability</th>
              {data.roles.map((role) => (
                <th key={role} className="text-center font-medium text-gray-500 dark:text-gray-400 px-4 py-3 whitespace-nowrap">
                  {ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.capabilities.map((cap) => (
              <tr key={cap.key} className="border-b border-[hsl(var(--border))] last:border-0">
                <td className="px-6 py-4">
                  <div className="font-medium text-gray-900 dark:text-white">{cap.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{cap.description}</div>
                </td>
                {data.roles.map((role) => {
                  const enabled = data.matrix[role][cap.key];
                  const cellKey = `${role}:${cap.key}`;
                  const busy = busyCell === cellKey;
                  return (
                    <td key={role} className="px-4 py-4 text-center">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(role, cap.key, enabled)}
                        aria-pressed={enabled}
                        aria-label={`${cap.label} for ${ROLE_LABELS[role]}`}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50
                          ${enabled ? 'bg-[hsl(var(--primary))]' : 'bg-gray-300 dark:bg-gray-700'}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                            ${enabled ? 'translate-x-6' : 'translate-x-1'}`}
                        />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
