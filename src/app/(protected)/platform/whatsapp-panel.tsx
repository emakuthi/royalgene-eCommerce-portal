'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type View = {
  available: boolean;
  phoneNumberId: string;
  hasAccessToken: boolean;
  tokenReadable: boolean;
  template: string;
  language: string;
  configured: boolean;
};

async function call(token: string | null | undefined, method: string, body?: unknown) {
  const res = await fetch('/api/platform/whatsapp', {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  }).catch(() => null);
  const json = res ? await res.json().catch(() => ({})) : {};
  return { ok: !!res?.ok && json?.success !== false, data: json?.data as View | undefined, error: json?.error as string | undefined, message: json?.message as string | undefined };
}

/**
 * The account owners' daily reports are sent from (Meta WhatsApp Cloud API).
 * Fill it in once the provider gives you the number: phone number ID and a
 * permanent access token from WhatsApp Manager, and the approved template.
 */
export function WhatsappPanel({ token }: { token: string | null | undefined }) {
  const [view, setView] = useState<View | null>(null);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [template, setTemplate] = useState('');
  const [language, setLanguage] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);

  function apply(v: View) {
    setView(v);
    setPhoneNumberId(v.phoneNumberId);
    setTemplate(v.template);
    setLanguage(v.language);
    setAccessToken('');
  }

  useEffect(() => {
    if (!token) return;
    call(token, 'GET').then((r) => { if (r.ok && r.data) apply(r.data); });
  }, [token]);

  async function save() {
    setBusy('save');
    const body: Record<string, string> = { phoneNumberId, template, language };
    if (accessToken.trim()) body.accessToken = accessToken.trim();
    const r = await call(token, 'PUT', body);
    setBusy(null);
    if (!r.ok || !r.data) { toast.error(r.error || 'Could not save'); return; }
    apply(r.data);
    toast.success(r.data.configured ? 'Saved. WhatsApp sending is on' : 'Saved');
  }

  async function removeToken() {
    setBusy('remove');
    const r = await call(token, 'PUT', { accessToken: '' });
    setBusy(null);
    if (!r.ok || !r.data) { toast.error(r.error || 'Could not remove'); return; }
    apply(r.data);
    toast.success('Access token removed. Sending is off');
  }

  async function test() {
    setBusy('test');
    const r = await call(token, 'POST', { to: testTo });
    setBusy(null);
    if (r.ok) toast.success(r.message || 'Sent');
    else toast.error(r.error || 'Could not send');
  }

  if (!view) {
    return <div className="text-sm text-gray-400 flex items-center"><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</div>;
  }
  if (!view.available) {
    return <p className="text-sm text-amber-600 dark:text-amber-400">Run migration 20261111_02_platform_whatsapp.sql on the database to set this up here.</p>;
  }

  const label = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1';
  return (
    <div className="space-y-5">
      <div className={`text-sm font-medium ${view.configured ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}>
        {view.configured ? 'Sending is on' : 'Not set up: no messages are sent'}
      </div>
      {view.hasAccessToken && !view.tokenReadable && (
        <p className="text-sm text-red-600">The saved access token can&apos;t be read (the server&apos;s encryption key is missing or changed). Paste it again.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={label} htmlFor="wa-phone-id">Phone number ID</label>
          <Input id="wa-phone-id" inputMode="numeric" placeholder="e.g. 109876543210987" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
          <p className="text-xs text-gray-500 mt-1">WhatsApp Manager → Phone numbers. Not the phone number itself.</p>
        </div>
        <div>
          <label className={label} htmlFor="wa-token">Access token</label>
          <Input id="wa-token" type="password" autoComplete="off" placeholder={view.hasAccessToken ? 'Saved. Paste a new one to replace it' : 'Permanent system-user token'} value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          <p className="text-xs text-gray-500 mt-1">Stored encrypted; never shown again.</p>
        </div>
        <div>
          <label className={label} htmlFor="wa-template">Report template name</label>
          <Input id="wa-template" value={template} onChange={(e) => setTemplate(e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="wa-lang">Template language</label>
          <Input id="wa-lang" value={language} onChange={(e) => setLanguage(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy !== null}>{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}</Button>
        {view.hasAccessToken && (
          <Button variant="outline" onClick={removeToken} disabled={busy !== null}>Remove token</Button>
        )}
      </div>
      <div className="pt-4 border-t border-[hsl(var(--border))]">
        <label className={label} htmlFor="wa-test">Send a test report</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input id="wa-test" inputMode="tel" placeholder="0712 345 678" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button variant="outline" onClick={test} disabled={busy !== null || !view.configured || !testTo.trim()}>
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send test'}
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-1">Sends the report template with sample numbers. The template must be approved in WhatsApp Manager first.</p>
      </div>
    </div>
  );
}
