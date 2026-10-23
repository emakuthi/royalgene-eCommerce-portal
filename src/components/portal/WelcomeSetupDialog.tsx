'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBranding } from '@/lib/branding-context';
import { BUSINESS_TYPES } from '@/lib/business-types';

/**
 * Shown once after a Google sign-up (/dashboard?welcome=1). Google skips the
 * signup form, so the workspace was named "<Google name>'s Workspace" and set
 * up as the default business type — this lets the owner fix both up front.
 * Skipping keeps the generated name; it stays editable in Settings.
 */
export default function WelcomeSetupDialog({ token }: { token: string | null | undefined }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { branding, refresh: refreshBranding } = useBranding();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState(branding.businessType);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (searchParams.get('welcome') !== '1' || !token) return;
    setName(branding.companyName);
    setType(branding.businessType);
    setOpen(true);
    // Only seed the fields when the dialog first opens, not on every branding refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, token]);

  function close() {
    setOpen(false);
    router.replace('/dashboard'); // drop ?welcome=1 so a reload doesn't reopen it
  }

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error('Enter your business name');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/portal/business', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessName: trimmed, businessType: type }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json?.success === false) {
        toast.error(json?.error || 'Could not save');
        return;
      }
      await refreshBranding();
      toast.success('Your business is set up');
      close();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) close(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Welcome! Let&apos;s set up your business</DialogTitle>
          <DialogDescription>
            We named your workspace from your Google account. Change it to your business name. It shows on your receipts, reports and staff accounts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5 mt-1">
          <div className="space-y-1.5">
            <Label htmlFor="welcome-business-name">Business name</Label>
            <Input
              id="welcome-business-name"
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }}
              placeholder="e.g. Mama Njeri Boutique"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Type of business</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {BUSINESS_TYPES.map((t) => {
                const active = t.id === type;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setType(t.id)}
                    aria-pressed={active}
                    className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                      active
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 ring-1 ring-[hsl(var(--primary))]'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="font-medium text-sm text-gray-900 dark:text-white">{t.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">You can change both later in Settings.</p>
        </div>
        <DialogFooter className="mt-4">
          <Button type="button" variant="outline" onClick={close} disabled={saving}>Skip for now</Button>
          <Button type="button" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
