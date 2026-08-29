'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DomainState } from '@/lib/domains';

interface DomainManagerProps {
  state: DomainState | null;
  loading?: boolean;
  busy?: boolean;
  /** Copy for the empty-state input. Defaults to a tenant subdomain example. */
  placeholder?: string;
  onAdd: (domain: string) => void;
  onRefresh: () => void;
  onRemove: () => void;
}

const STATUS_COPY: Record<NonNullable<DomainState['status']>, { text: string; cls: string }> = {
  verified: { text: 'Verified — this domain is live', cls: 'text-emerald-600' },
  misconfigured: { text: 'DNS not pointed correctly yet', cls: 'text-amber-600' },
  pending: { text: 'Pending DNS setup', cls: 'text-gray-500 dark:text-gray-400' },
};

/**
 * Presentational custom-domain manager. State + persistence live in the caller
 * (tenant Settings → Domain, or the platform admin console) — this only renders
 * the current domain, its live status, the DNS records to add, and the add/
 * remove/re-check controls.
 */
export function DomainManager({
  state,
  loading,
  busy,
  placeholder = 'shop.yourdomain.com',
  onAdd,
  onRefresh,
  onRemove,
}: DomainManagerProps) {
  const [input, setInput] = useState('');

  if (loading && !state) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>;
  }

  if (state?.domain) {
    const status = state.status ? STATUS_COPY[state.status] : STATUS_COPY.pending;
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{state.domain}</p>
            <p className={`text-xs mt-0.5 ${status.cls}`}>{status.text}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" size="sm" disabled={busy} onClick={onRefresh}>Check status</Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              disabled={busy}
              onClick={onRemove}
            >
              Remove
            </Button>
          </div>
        </div>

        {state.status !== 'verified' && state.instructions && (
          <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-3 text-sm">
            <p className="font-medium text-gray-900 dark:text-white">DNS setup</p>
            <p className="text-gray-500 dark:text-gray-400">
              At the domain&apos;s registrar, add one of the following (subdomain like{' '}
              <code>shop.yourdomain.com</code> → CNAME; root domain like <code>yourdomain.com</code> → A record):
            </p>
            <div className="font-mono text-xs bg-gray-50 dark:bg-gray-800 rounded p-3 space-y-1">
              <p>CNAME → {state.instructions.cnameTarget}</p>
              <p>A → {state.instructions.aRecordTarget}</p>
            </div>
            {state.instructions.verification.length > 0 && (
              <>
                <p className="text-gray-500 dark:text-gray-400">Also add this TXT record to prove ownership:</p>
                <div className="font-mono text-xs bg-gray-50 dark:bg-gray-800 rounded p-3 space-y-1">
                  {state.instructions.verification.map((v, i) => (
                    <p key={i}>TXT {v.domain} → {v.value}</p>
                  ))}
                </div>
              </>
            )}
            <p className="text-xs text-gray-400">DNS changes can take a few minutes to a few hours to propagate.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = input.trim();
        if (trimmed) onAdd(trimmed);
      }}
      className="flex items-end gap-3"
    >
      <div className="flex-1">
        <Label htmlFor="dm-domain">Domain</Label>
        <Input
          id="dm-domain"
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
      </div>
      <Button type="submit" disabled={busy || !input.trim()}>{busy ? 'Adding…' : 'Add Domain'}</Button>
    </form>
  );
}
