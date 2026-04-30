'use client';

import React, { useState } from 'react';
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
      if (!res.ok && (res.status === 401 || res.status === 403)) {
        res = await createShopPortal(token, { name: form.name, location: form.location, phone: form.phone, email: form.email });
      }

      if (res.ok && res.success) {
        toast.success('Shop created');
        // go back to shops list
        router.push('/portal/shops');
        setValidationErrors(null);
      } else {
        // show field-level validation if provided
        if (res.validation) {
          setValidationErrors(res.validation);
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
      <PortalHeader backHref="/portal/shops" title="Add New Shop" description="Create a new shop/outlet" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Shops', href: '/portal/shops' }, { label: 'Add New' }]} />

      <div className="w-full px-4 sm:px-6 py-6 pb-12">
        <div className="max-w-3xl mx-auto">
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
                  <Button variant="outline" onClick={() => router.push('/portal/shops')}>Cancel</Button>
                  <Button type="submit" className="ml-2 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" disabled={creating}>{creating ? 'Creating...' : 'Create Shop'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
