'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import PortalHeader from '@/components/portal/PortalHeader';
import { useHydratedAuth } from '@/lib/hooks';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { createShop as createShopApi, createShopPortal } from '@/lib/shops';

export default function AddShopPage() {
  const { token } = useHydratedAuth();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', location: '', phone: '', email: '' });
  const [validationErrors, setValidationErrors] = useState<Record<string,string> | null>(null);
  const [shopLimit, setShopLimit] = useState<{ limit: number; usage: number; planName: string | null } | null>(null);

  // Check the plan's shop allowance up front, so a full plan shows an upgrade
  // prompt instead of a form that would only fail on submit.
  useEffect(() => {
    if (!token) return;
    fetch('/api/portal/billing/usage', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        const b = d?.data?.limits?.BRANCHES;
        if (d?.success && b && typeof b.limit === 'number') {
          setShopLimit({ limit: b.limit, usage: b.usage ?? 0, planName: d.data.plan?.name ?? null });
        }
      })
      .catch(() => {});
  }, [token]);
  const atShopLimit = shopLimit !== null && shopLimit.usage >= shopLimit.limit;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!form.name || !form.location) {
      toast.error('Name and location are required');
      return;
    }
    if (!token) {
      toast.error('You must be signed in to create a shop');
      return;
    }

    setCreating(true);
    try {
      let res = await createShopApi(token, { name: form.name, location: form.location, phone: form.phone, email: form.email, manager: null });
      if (!res.ok && (res.status === 401 || res.status === 403) && res.code !== 'PLAN_LIMIT_REACHED') {
        res = await createShopPortal(token, { name: form.name, location: form.location, phone: form.phone, email: form.email });
      }

      if (res.ok && res.success) {
        toast.success('Shop created');
        // go back to shops list
        router.push('/shops');
        setValidationErrors(null);
      } else {
        // show field-level validation if provided
        if (res.validation) {
          setValidationErrors(res.validation);
        } else if (res.code === 'PLAN_LIMIT_REACHED') {
          toast.error(res.error || 'Your plan’s shop limit has been reached.', {
            action: { label: 'Upgrade', onClick: () => router.push('/settings?tab=billing') },
            duration: 10000,
          });
        } else {
          toast.error(res.error || 'Failed to create shop');
        }
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to create shop');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 min-h-screen">
      <PortalHeader backHref="/shops" title="Add New Shop" description="Create a new shop/outlet" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Shops', href: '/shops' }, { label: 'Add New' }]} />

      <div className="w-full px-4 sm:px-6 py-6 pb-12">
        <div className="max-w-3xl mx-auto">
          {atShopLimit && shopLimit ? (
            <Card>
              <CardHeader>
                <CardTitle>You've reached your shop limit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  {shopLimit.planName ? `Your ${shopLimit.planName} plan` : 'Your plan'} includes {shopLimit.limit} {shopLimit.limit === 1 ? 'shop' : 'shops'}, and you're using {shopLimit.usage}.
                  Upgrade your plan to add another shop.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => router.push('/shops')}>Not now</Button>
                  <Button className="bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" onClick={() => router.push('/settings?tab=billing')}>Upgrade plan</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
          <Card>
            <CardHeader>
              <CardTitle>Create Shop</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Shop name *</Label>
                  <Input value={form.name} onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Main Branch" required />
                  {validationErrors?.name && <p className="text-xs text-red-500 mt-1">{validationErrors.name}</p>}
                </div>

                <div>
                  <Label>Location *</Label>
                  <Input value={form.location} onChange={(e) => setForm(prev => ({ ...prev, location: e.target.value }))} placeholder="e.g. 123 Market St" required />
                  {validationErrors?.location && <p className="text-xs text-red-500 mt-1">{validationErrors.location}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="Optional" />
                    {validationErrors?.phone && <p className="text-xs text-red-500 mt-1">{validationErrors.phone}</p>}
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))} placeholder="Optional" />
                    {validationErrors?.email && <p className="text-xs text-red-500 mt-1">{validationErrors.email}</p>}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => router.push('/shops')}>Cancel</Button>
                  <Button type="submit" className="ml-2 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" disabled={creating}>{creating ? 'Creating...' : 'Create Shop'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          )}
        </div>
      </div>
    </div>
  );
}
