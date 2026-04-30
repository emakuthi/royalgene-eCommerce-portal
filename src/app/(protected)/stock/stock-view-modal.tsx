'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/image-upload';
import { X } from 'lucide-react';
import type { Product, ShopStock } from '@/lib/types';
type ApiShopStock = ShopStock & { Product?: Product; product?: Product; shopName?: string };
type ViewFormType = {
  name: string;
  sku: string;
  description: string;
  costPrice: string;
  sellingPrice: string;
  sizes: string[];
  colors: string[];
  images: string[];
  quantity: number;
  lowStockThreshold: number;
};

// eslint-disable-next-line react/display-name,import/no-anonymous-default-export
export default ({
                  stock,
                  open,
                  onClose,
                  viewForm,
                  setViewForm,
                  onImageAdd,
                  onImageRemove,
                  onSave,
                  onDelete,
                  saving,
                  deleting,
                }: {
  stock: ApiShopStock;
  open: boolean;
  onClose: () => void;
  viewForm: ViewFormType;
  setViewForm: (v: ViewFormType) => void;
  onImageAdd: (url: string) => void;
  onImageRemove: (url: string) => void;
  onSave: (stockId: string, productPayload: Record<string, unknown>, stockPayload: Record<string, unknown>) => Promise<boolean>;
  onDelete: (stockId: string, productId?: string) => Promise<boolean>;
  saving: boolean;
  deleting: boolean;
}) => {
  if (!open) return null;

  const prod = (stock.product ?? stock.Product) as Product | undefined;

  const handleSaveClick = async () => {
    const productPayload: Record<string, unknown> = {
      id: prod?.id,
      name: viewForm.name,
      sku: viewForm.sku,
      description: viewForm.description,
      price: viewForm.sellingPrice ? Number(viewForm.sellingPrice) : (prod?.price ?? 0),
      costPrice: viewForm.costPrice ? Number(viewForm.costPrice) : undefined,
      images: viewForm.images,
      sizes: viewForm.sizes,
      colors: viewForm.colors,
    };

    const stockPayload: Record<string, unknown> = {
      stockId: stock.id,
      quantity: viewForm.quantity,
      lowStockThreshold: viewForm.lowStockThreshold,
    };

    const ok = await onSave(stock.id, productPayload, stockPayload);
    if (ok) onClose();
  };

  const handleDeleteClick = async () => {
    const ok = await onDelete(stock.id, prod?.id);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 z-40" onClick={() => { if (!saving && !deleting) onClose(); }} />
      <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-3xl z-50 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header (sticky) */}
        <div className="sticky top-0 z-50 bg-white dark:bg-gray-900 p-6 border-b">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">{viewForm.name || 'Product details'}</h3>
              <p className="text-sm text-muted-foreground">SKU: {viewForm.sku}</p>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600">Name</label>
              <Input value={viewForm.name} onChange={(e) => setViewForm({ ...viewForm, name: e.target.value })} />
              <label className="block text-sm text-gray-600 mt-2">Description</label>
              <Input value={viewForm.description} onChange={(e) => setViewForm({ ...viewForm, description: e.target.value })} />

              <div className="mt-4">
                <p className="text-sm text-gray-600">Images</p>
                <ImageUpload images={viewForm.images} onImageUpload={(u) => { onImageAdd(u); setViewForm({ ...viewForm, images: [...viewForm.images, u] }); }} onRemove={(u) => { onImageRemove(u); setViewForm({ ...viewForm, images: viewForm.images.filter(x => x !== u) }); }} />
              </div>

              <div className="mt-4">
                <p className="text-sm text-gray-600">Sizes</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(viewForm.sizes || []).map(s => (
                    <div key={s} className="inline-flex items-center gap-2 bg-gray-100 rounded-full px-2 py-1 text-xs">
                      <span>{s}</span>
                      <button type="button" className="p-1 rounded-full hover:bg-gray-200" onClick={() => setViewForm({ ...viewForm, sizes: viewForm.sizes.filter(x => x !== s) })}><X className="w-3 h-3" /></button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <Input placeholder="Add size and press Enter" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const v = (e.target as HTMLInputElement).value.trim(); if (v) { setViewForm({ ...viewForm, sizes: Array.from(new Set([...viewForm.sizes, v])) }); (e.target as HTMLInputElement).value = ''; } } }} />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm text-gray-600">SKU</label>
              <Input value={viewForm.sku} onChange={(e) => setViewForm({ ...viewForm, sku: e.target.value })} />

              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-sm text-gray-600">Cost Price (KES)</label>
                  <Input value={viewForm.costPrice} onChange={(e) => setViewForm({ ...viewForm, costPrice: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm text-gray-600">Selling Price (KES)</label>
                  <Input value={viewForm.sellingPrice} onChange={(e) => setViewForm({ ...viewForm, sellingPrice: e.target.value })} />
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm text-gray-600">Quantity</label>
                <Input type="number" value={viewForm.quantity} onChange={(e) => setViewForm({ ...viewForm, quantity: Number(e.target.value) })} />
              </div>

              <div className="mt-3">
                <label className="block text-sm text-gray-600">Low Stock Threshold</label>
                <Input type="number" value={viewForm.lowStockThreshold} onChange={(e) => setViewForm({ ...viewForm, lowStockThreshold: Number(e.target.value) })} />
              </div>
            </div>
          </div>
        </div>

        {/* Sticky footer with actions */}
        <div className="sticky bottom-0 z-50 bg-white dark:bg-gray-900 p-6 border-t">
          <div className="flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={handleDeleteClick} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete'}</Button>
            <Button type="button" onClick={handleSaveClick} className="bg-[hsl(var(--primary))] text-white" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
