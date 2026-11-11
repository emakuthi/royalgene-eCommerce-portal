'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const card = 'bg-white dark:bg-gray-900 rounded-2xl border border-[hsl(var(--border))] overflow-hidden';
const field = 'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm';

/**
 * Settings -> Business: the owner's end-of-day summary on WhatsApp — each
 * shop's sales, M-Pesa vs cash, stock running out and deleted sales.
 */
export default function DailyReportCard({ token }: { token: string | null | undefined }) {
  const [saved, setSaved] = useState('');
  const [number, setNumber] = useState('');
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch('/api/portal/business/daily-report', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          setSaved(j.data.whatsapp ?? '');
          setNumber(j.data.whatsapp ? `+${j.data.whatsapp}` : '');
          setAvailable(j.data.available !== false);
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [token]);

  async function send(method: 'PUT' | 'POST', body?: unknown) {
    const res = await fetch('/api/portal/business/daily-report', {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    return { ok: !!res?.ok && json?.success !== false, data: json?.data, error: json?.error as string | undefined, message: json?.message as string | undefined };
  }

  async function save(value: string) {
    setBusy('save');
    const res = await send('PUT', { whatsapp: value });
    setBusy(null);
    if (!res.ok) { toast.error(res.error || 'Could not save'); return; }
    setSaved(res.data.whatsapp ?? '');
    setNumber(res.data.whatsapp ? `+${res.data.whatsapp}` : '');
    toast.success(res.data.whatsapp ? 'Daily report turned on' : 'Daily report turned off');
  }

  async function test() {
    setBusy('test');
    const res = await send('POST');
    setBusy(null);
    if (res.ok) toast.success(res.message || 'Sent');
    else toast.error(res.error || 'Could not send');
  }

  return (
    <div className={card}>
      <div className="px-6 py-5 flex items-start gap-3">
        <MessageCircle className="h-5 w-5 text-[hsl(var(--primary))] mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Daily WhatsApp report</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Every evening at 9 PM: each shop&apos;s sales, M-Pesa vs cash, stock running out and any deleted sales — sent to your WhatsApp.
          </p>
          {!loaded ? (
            <div className="mt-4 text-sm text-gray-400 flex items-center"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</div>
          ) : (
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <input
                className={field}
                inputMode="tel"
                placeholder="0712 345 678"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                disabled={busy !== null}
                aria-label="WhatsApp number for the daily report"
              />
              <Button onClick={() => save(number)} disabled={busy !== null || number.replace(/\D/g, '') === saved}>
                {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
              </Button>
              {saved && (
                <>
                  <Button variant="outline" onClick={test} disabled={busy !== null || !available}>
                    {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send test now'}
                  </Button>
                  <Button variant="outline" onClick={() => save('')} disabled={busy !== null}>Turn off</Button>
                </>
              )}
            </div>
          )}
          {loaded && !available && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">WhatsApp sending isn&apos;t switched on for RoyalTrack yet. Your number is saved and reports start once it is.</p>
          )}
        </div>
      </div>
    </div>
  );
}
