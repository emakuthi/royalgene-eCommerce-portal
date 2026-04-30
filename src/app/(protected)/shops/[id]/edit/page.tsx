'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import PortalHeader from '@/components/portal/PortalHeader';
import { useHydratedAuth } from '@/lib/hooks';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

import { getShopById, updateShop } from '@/lib/shops';

type ShopDto = { name?: string; location?: string; phone?: string; email?: string };

export default function EditShopPage() {
  const router = useRouter();
  const params = useParams() as { id?: string };
  const id = params?.id;
  const { token } = useHydratedAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', location: '', phone: '', email: '' });
  const [validationErrors, setValidationErrors] = useState<Record<string,string> | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    (async () => {
      try {
        const res = await getShopById<ShopDto>(token, id);
        if (res.ok && res.success && res.data) {
          const s = res.data;
          setForm({ name: s.name ?? '', location: s.location ?? '', phone: s.phone ?? '', email: s.email ?? '' });
          setValidationErrors(null);
        } else {
          toast.error(res.error || 'Failed to load shop');
        }
      } catch (err) {
        console.error(err);
        toast.error('Failed to load shop');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, token]);

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!id || !token) return;
    setSaving(true);
    try {
      const res = await updateShop(token, id, { name: form.name, location: form.location, phone: form.phone, email: form.email });
      if (res.ok && res.success) {
        toast.success('Shop updated');
        setValidationErrors(null);
        router.push('/shops');
      } else {
        if (res.validation) setValidationErrors(res.validation);
        else toast.error(res.error || 'Failed to update');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to update');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;

  return (
    <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 min-h-screen">
      <PortalHeader backHref="/shops" title="Edit Shop" description={`Edit shop ${id}`} breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Shops', href: '/shops' }, { label: 'Edit' }]} />

      <div className="w-full px-4 sm:px-6 py-6 pb-12">
        <div className="max-w-3xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>Edit Shop</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <Label>Shop name *</Label>
                  <Input value={form.name} onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))} required />
                  {validationErrors?.name && <p className="text-xs text-red-500 mt-1">{validationErrors.name}</p>}
                </div>

                <div>
                  <Label>Location *</Label>
                  <Input value={form.location} onChange={(e) => setForm(prev => ({ ...prev, location: e.target.value }))} required />
                  {validationErrors?.location && <p className="text-xs text-red-500 mt-1">{validationErrors.location}</p>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label>Phone</Label>
                    <Input value={form.phone} onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))} />
                    {validationErrors?.phone && <p className="text-xs text-red-500 mt-1">{validationErrors.phone}</p>}
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={form.email} onChange={(e) => setForm(prev => ({ ...prev, email: e.target.value }))} />
                    {validationErrors?.email && <p className="text-xs text-red-500 mt-1">{validationErrors.email}</p>}
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button variant="outline" onClick={() => router.push('/shops')}>Cancel</Button>
                  <Button type="submit" className="ml-2 bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
