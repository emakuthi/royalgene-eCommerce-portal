'use client';

import React, { useState } from 'react';
import { useHydratedAuth } from '@/lib/hooks';
import { useRouter } from 'next/navigation';

export default function AlertsNewForm({ defaultShopId }: { defaultShopId?: string }) {
  const { token } = useHydratedAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState('info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/portal/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ title, message, level, shopId: defaultShopId }),
      });
      if (!res.ok) {
        const msg = `Server returned ${res.status}`;
        setError(msg);
        setLoading(false);
        return;
      }
      const json = await res.json();
      if (!json?.success) {
        setError(json?.message || 'Failed to create alert');
        setLoading(false);
        return;
      }
      // navigate back to alerts
      router.push('/portal/alerts');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-2xl">
      <div>
        <label className="block text-sm font-medium text-gray-700">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 block w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Message</label>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 block w-full rounded border px-3 py-2" rows={4} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">Level</label>
        <select value={level} onChange={(e) => setLevel(e.target.value)} className="mt-1 block w-48 rounded border px-3 py-2">
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex items-center gap-2">
        <button disabled={loading} className="px-4 py-2 bg-[hsl(var(--primary))] text-white rounded">Create</button>
        <button type="button" onClick={() => router.push('/portal/alerts')} className="px-4 py-2 border rounded">Cancel</button>
      </div>
    </form>
  );
}
