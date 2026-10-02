'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHydratedAuth } from '@/lib/hooks';
import { RefreshCw } from 'lucide-react';

interface Currency { code: string; name: string; symbol: string; decimals: number; isActive: boolean; isBase: boolean }
interface Rate {
  id: string; organizationId?: string | null; baseCurrency: string; targetCurrency: string;
  rate: number; rateDate: string; source: string; manuallyOverridden: boolean;
}

const GLOBAL_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Admin panel: currency reference list + exchange-rate table with source badges
 * (Auto / Manual override), last-updated, inline manual override, and Sync Now.
 * Read-only for non-admins. Self-contained — fetches its own data via the token.
 */
export default function CurrencyRatesPanel({ canEdit }: { canEdit: boolean }) {
  const { token } = useHydratedAuth();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingPair, setSavingPair] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [cRes, rRes] = await Promise.all([
        fetch('/api/currencies', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/exchange-rates', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const cJson = await cRes.json().catch(() => ({}));
      const rJson = await rRes.json().catch(() => ({}));
      if (cJson?.success) setCurrencies(cJson.data ?? []);
      if (rJson?.success) setRates(rJson.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const base = currencies.find((c) => c.isBase)?.code ?? 'KES';
  const activeTargets = currencies.filter((c) => c.isActive && c.code !== base);

  /** The rate row (override preferred) + whether it's a manual override, for base→target. */
  function rowFor(target: string): { rate?: Rate; isOverride: boolean } {
    const override = rates.find((r) => r.baseCurrency === base && r.targetCurrency === target && r.organizationId && r.organizationId !== GLOBAL_ID);
    if (override) return { rate: override, isOverride: true };
    const global = rates.find((r) => r.baseCurrency === base && r.targetCurrency === target && (!r.organizationId || r.organizationId === GLOBAL_ID));
    return { rate: global, isOverride: false };
  }

  async function syncNow() {
    if (!token) return;
    setSyncing(true); setMsg(null);
    try {
      const res = await fetch('/api/exchange-rates/sync', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json().catch(() => ({}));
      setMsg(json?.success ? `Synced ${json.data?.count ?? 0} rates (${json.data?.date ?? 'today'}).` : (json?.error || 'Sync failed — rates left unchanged.'));
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function saveOverride(target: string) {
    if (!token) return;
    const raw = drafts[target]?.trim();
    const rate = Number(raw);
    if (!raw || !Number.isFinite(rate) || rate <= 0) { setMsg('Enter a positive rate.'); return; }
    setSavingPair(target); setMsg(null);
    try {
      const res = await fetch('/api/exchange-rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ baseCurrency: base, targetCurrency: target, rate }),
      });
      const json = await res.json().catch(() => ({}));
      setMsg(json?.success ? `Override saved: 1 ${base} = ${rate} ${target}` : (json?.error || 'Failed to save override.'));
      setDrafts((d) => ({ ...d, [target]: '' }));
      await load();
    } finally {
      setSavingPair(null);
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground py-4">Loading exchange rates…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 dark:text-gray-400">Rates are relative to <strong>{base}</strong> (base). Auto rates come from Frankfurter; you can override any pair for this workspace.</p>
        {canEdit && (
          <Button type="button" variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </Button>
        )}
      </div>

      {msg && <p className="text-xs text-gray-500 dark:text-gray-400">{msg}</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-900/50 text-left text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2">Pair</th>
              <th className="px-3 py-2">Rate (1 {base} =)</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Updated</th>
              {canEdit && <th className="px-3 py-2">Manual override</th>}
            </tr>
          </thead>
          <tbody>
            {activeTargets.map((c) => {
              const { rate, isOverride } = rowFor(c.code);
              return (
                <tr key={c.code} className="border-t border-gray-100 dark:border-gray-800">
                  <td className="px-3 py-2 font-medium">{base} → {c.code}</td>
                  <td className="px-3 py-2">{rate ? `${rate.rate} ${c.code}` : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2">
                    {!rate ? <span className="text-gray-400">no rate</span> : isOverride ? (
                      <span className="inline-block rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 px-2 py-0.5 text-xs">Manual override</span>
                    ) : (
                      <span className="inline-block rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 px-2 py-0.5 text-xs">Auto</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">{rate?.rateDate ?? '—'}</td>
                  {canEdit && (
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={drafts[c.code] ?? ''}
                          onChange={(e) => setDrafts((d) => ({ ...d, [c.code]: e.target.value }))}
                          placeholder={rate ? String(rate.rate) : '0.00'}
                          inputMode="decimal"
                          className="h-8 w-28"
                        />
                        <Button type="button" size="sm" variant="outline" disabled={savingPair === c.code} onClick={() => saveOverride(c.code)}>
                          {savingPair === c.code ? '…' : 'Set'}
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {activeTargets.length === 0 && (
              <tr><td colSpan={canEdit ? 5 : 4} className="px-3 py-4 text-center text-gray-400">No active currencies besides the base.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
