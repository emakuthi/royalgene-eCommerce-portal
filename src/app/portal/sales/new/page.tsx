'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import PortalHeader from '@/components/portal/PortalHeader';
import { computePrefillForm } from '@/lib/sales-prefill';
import type { Product } from '@/lib/types';
import { useTheme } from '@/lib/theme-context';

// ApiStock represents the shop stock row returned by /api/portal/stock
type ApiStock = {
  id: string;
  shopId: string;
  productId: string;
  quantity: number;
  lowStockThreshold?: number | undefined;
  Product?: Product | null;
  product?: Product | null;
};

type RecentSale = {
  id: string;
  productName?: string | null;
  quantity: number;
  totalAmountCents?: number;
  createdAt?: string | null;
};

function formatCurrency(amount: number) {
  return `KES ${Number(amount).toFixed(2)}`;
}

export default function NewSalePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token } = useHydratedAuth();
  const { currentShop } = usePortalStore();
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [stocks, setStocks] = useState<ApiStock[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);

  // recent sales + stats
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [salesStats, setSalesStats] = useState({ totalSales: 0, totalRevenueCents: 0, avgItemsPerSale: 0 });

  // primary form data - keep numeric canonical values here when possible
  const [formData, setFormData] = useState({
    shopStockId: searchParams?.get('shopStockId') || '',
    productId: searchParams?.get('productId') || '',
    quantity: parseInt(searchParams?.get('quantity') || '1', 10) || 1,
    unitPrice: Number(searchParams?.get('unitPrice') || '0') || 0,
    discount: Number(searchParams?.get('discount') || '0') || 0,
    paymentMethod: searchParams?.get('paymentMethod') || 'cash',
    customerName: searchParams?.get('customerName') || '',
    customerPhone: searchParams?.get('customerPhone') || '',
    notes: searchParams?.get('notes') || '',
  });

  // string-backed inputs (allow typing partial values like "1.", "", "0.0")
  const [quantityInput, setQuantityInput] = useState(String(formData.quantity || 1));
  const [unitPriceInput, setUnitPriceInput] = useState((formData.unitPrice || 0).toFixed(2));
  const [discountInput, setDiscountInput] = useState(String(formData.discount || 0));

  const labelActiveText = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const labelInactiveText = theme === 'dark' ? 'text-gray-300' : 'text-gray-700';
  const labelBgInactive = theme === 'dark' ? 'bg-gray-800' : 'bg-white';

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // If saleId is present, fetch sale and populate form
    if (!mounted || !token) return;

    const saleId = searchParams?.get('saleId');
    if (saleId) {
      setEditingSaleId(saleId);
      (async () => {
        try {
          const res = await fetch(`/api/portal/sales/${encodeURIComponent(saleId)}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return;
          const j = await res.json();
          if (j?.success && j.data) {
            const s = j.data;
            const newForm = {
              shopStockId: s.shopStockId || '',
              productId: s.productId || '',
              quantity: s.quantity || 1,
              unitPrice: s.unitPrice || 0,
              discount: s.discount || 0,
              paymentMethod: s.paymentMethod === 'mobile_money' ? 'mpesa' : s.paymentMethod,
              customerName: s.customerName || '',
              customerPhone: s.customerPhone || '',
              notes: s.notes || '',
            };
            setFormData(newForm);
          }
        } catch (err) {
          console.warn('Failed to fetch sale for edit', err);
        }
      })();
    }
  }, [mounted, searchParams, token]);

  useEffect(() => {
    // Fetch stocks for shop - only run when shop or token changes
    // Wait for mounted to ensure store is hydrated
    if (!mounted || !currentShop?.id || !token) return;

    (async () => {
      try {
        setLoadingStocks(true);
        const url = `/api/portal/stock?shopId=${currentShop.id}`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        if (!r.ok) {
          console.error('[Stock Fetch] Request failed', { status: r.status });
          return;
        }

        const d = await r.json();

        if (d?.success) {
          const items: ApiStock[] = (d.data || []).map((s: unknown) => {
            const row = s as Record<string, unknown>;
            const productRel = row['Product'] ?? row['product'];

            let productObj: Product | null = null;
            if (productRel && typeof productRel === 'object') {
              const maybe = productRel as Record<string, unknown>;
              productObj = {
                id: String(maybe['id'] ?? ''),
                name: String(maybe['name'] ?? ''),
                price: typeof maybe['price'] === 'number' ? (maybe['price'] as number) : (typeof maybe['price'] === 'string' ? Number(maybe['price']) : undefined),
                sku: String(maybe['sku'] ?? ''),
                description: typeof maybe['description'] === 'string' ? maybe['description'] as string : undefined,
              } as unknown as Product;
            }

            const productId = productObj?.id ?? (typeof row['productId'] === 'string' ? row['productId'] as string : String(row['productId'] ?? ''));
            const quantity = typeof row['quantity'] === 'number' ? row['quantity'] as number : Number(row['quantity'] ?? 0);
            const lowRaw = row['lowStockThreshold'];

            return {
              id: String(row['id'] ?? ''),
              shopId: String(row['shopId'] ?? ''),
              productId,
              quantity,
              lowStockThreshold: lowRaw === null || lowRaw === undefined ? undefined : Number(lowRaw),
              Product: productObj ?? undefined,
              product: productObj ?? undefined,
            };
          });
          setStocks(items);
        }
      } catch (err) {
        console.error('[Stock Fetch] Error:', err);
      } finally {
        setLoadingStocks(false);
      }
    })();
  }, [mounted, currentShop?.id, token]);

  // Fetch recent sales and compute basic stats (graceful if API missing)
  useEffect(() => {
    if (!mounted || !currentShop?.id || !token) {
      setLoadingRecent(false);
      return;
    }

    (async () => {
      try {
        setLoadingRecent(true);
        const url = `/api/portal/sales?shopId=${currentShop.id}&limit=5`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        if (!res.ok) {
          setLoadingRecent(false);
          return;
        }

        const j = await res.json();
        if (!j?.success || !Array.isArray(j.data)) {
          setLoadingRecent(false);
          return;
        }

        const rows: RecentSale[] = (j.data || []).map((r: unknown) => {
          const rec = r as Record<string, unknown>;
          const productRel = (rec['product'] ?? rec['Product']) as Record<string, unknown> | undefined;
          return {
            id: String(rec['id'] ?? ''),
            productName: (rec['productName'] as string | undefined) ?? (productRel?.['name'] as string | undefined) ?? null,
            quantity: Number(rec['quantity'] ?? 0),
            totalAmountCents: Number(rec['totalAmount'] ?? rec['unitPrice'] ?? 0),
            createdAt: (rec['createdAt'] as string | undefined) ?? (rec['created_at'] as string | undefined) ?? null,
          } as RecentSale;
        });

        setRecentSales(rows);

        // compute stats
        const totalSales = rows.length;
        const totalRevenueCents = rows.reduce((acc, s) => acc + (s.totalAmountCents || 0), 0);
        const avgItemsPerSale = totalSales ? Math.round(rows.reduce((acc, s) => acc + s.quantity, 0) / totalSales) : 0;
        setSalesStats({ totalSales, totalRevenueCents, avgItemsPerSale });
      } catch (err) {
        console.error('Failed to fetch recent sales:', err);
      } finally {
        setLoadingRecent(false);
      }
    })();
  }, [mounted, currentShop?.id, token]);

  // Handle URL parameter prefilling - runs when stocks load
  useEffect(() => {
    if (stocks.length === 0 || formData.shopStockId) return; // Wait for stocks or skip if already selected

    // Auto-select first product
    const firstStock = stocks[0];
    const firstProduct = firstStock.product ?? firstStock.Product;
    const price = firstProduct?.price ?? 0;

    setFormData(prev => ({
      ...prev,
      shopStockId: firstStock.id,
      productId: firstStock.productId,
      unitPrice: price,
    }));
  }, [stocks, formData.shopStockId]);

  // Keep string inputs in sync when formData changes
  useEffect(() => {
    setQuantityInput(String(formData.quantity ?? 1));
    setUnitPriceInput((Number(formData.unitPrice ?? 0)).toFixed(2));
    setDiscountInput(String(formData.discount ?? 0));
  }, [formData.quantity, formData.unitPrice, formData.discount]);

  // derive totals from the typed input values (not forcing numeric parsing while typing)
  const parsedQuantity = Math.max(0, parseInt(quantityInput || '0', 10) || 0);
  const parsedUnitPrice = parseFloat(unitPriceInput || '0') || 0;
  const parsedDiscount = parseFloat(discountInput || '0') || 0;
  const totalAmount = Math.max(0, parsedUnitPrice * parsedQuantity - parsedDiscount);

  // Validation errors
  const [errors, setErrors] = useState<{ unitPrice?: string; customerPhone?: string }>({});

  function isValidPhone(phone?: string) {
    if (!phone) return true; // optional
    // allow digits, spaces, +, -, parentheses; require at least 7 digits
    const digits = (phone.match(/\d/g) || []).length;
    if (digits < 7) return false;
    const rx = /^[0-9+()\-\s]+$/;
    return rx.test(phone);
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // parse latest typed values into numbers for validation/submission
    const quantity = Math.max(0, parseInt(quantityInput || '0', 10) || 0);
    const unitPrice = parseFloat(unitPriceInput || '0') || 0;
    const discount = parseFloat(discountInput || '0') || 0;

    // client-side validation
    const newErrors: typeof errors = {};
    if (!formData.shopStockId) {
      toast.error('Please select a product from stock');
      return;
    }
    if (quantity <= 0) {
      toast.error('Quantity must be > 0');
      return;
    }
    if ((unitPrice || 0) <= 0) {
      newErrors.unitPrice = 'Unit price must be greater than 0';
    }
    if (formData.customerPhone && !isValidPhone(formData.customerPhone)) {
      newErrors.customerPhone = 'Invalid phone number format';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setSubmitting(true);
    try {
      const shopId = currentShop?.id;
      const discountPerItem = discount / Math.max(1, quantity);
      const payloadUnitPrice = Math.max(0, unitPrice - discountPerItem);
      const paymentMethod = formData.paymentMethod === 'mpesa' ? 'mobile_money' : formData.paymentMethod;

      if (editingSaleId) {
        const res = await fetch(`/api/portal/sales/${editingSaleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            quantity,
            unitPrice,
            paymentMethod,
            customerName: formData.customerName || null,
            customerPhone: formData.customerPhone || null,
            notes: formData.notes || null,
          }),
        });
        const j = await res.json();
        if (j.success) {
          toast.success('Sale updated');
          router.push('/portal/sales');
        } else {
          toast.error(j.error || 'Failed to update sale');
        }
      } else {
        const res = await fetch('/api/portal/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            shopId,
            shopStockId: formData.shopStockId,
            productId: formData.productId,
            quantity,
            unitPrice: payloadUnitPrice,
            paymentMethod,
            customerName: formData.customerName || null,
            customerPhone: formData.customerPhone || null,
            notes: formData.notes || null,
          }),
        });
        const j = await res.json();
        if (j.success) {
          toast.success('Sale recorded');
          router.push('/portal/sales');
        } else {
          toast.error(j.error || 'Failed to record sale');
        }
      }
    } catch (err) {
      console.error('Error recording sale', err);
      toast.error('Error recording sale');
    } finally {
      setSubmitting(false);
    }
  };


  if (!mounted) return <div className="flex items-center justify-center min-h-screen"><p>Loading...</p></div>;

  return (
    <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <PortalHeader backHref="/portal/sales" title={editingSaleId ? 'Edit Sale' : 'Record New Sale'} description="Enter sale details to record a new sale" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Sales', href: '/portal' }, { label: editingSaleId ? 'Edit' : 'New' }]} />

      {/* Main container uses a responsive grid: single column on small screens, 3 columns on sm+ where form spans 2 cols (2/3) and sidebar 1 col (1/3) */}
      {/* Use full viewport width - remove centered max width so layout uses full available space */}
      <div className="w-full px-4 sm:px-6 py-6 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Left: form (2/3) */}
          <div className="sm:col-span-2">
            <Card className="mt-6">
             <CardHeader>
               <CardTitle>{editingSaleId ? 'Edit Sale' : 'Record New Sale'}</CardTitle>
             </CardHeader>
             <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Product (select from shop stock) *</Label>
                  <p className="text-xs text-gray-500">Showing products available in <strong>{currentShop?.name || 'current shop'}</strong></p>
                  <div className="mt-2">
                    {loadingStocks ? (
                      <div className="space-y-2">
                        <div className="h-10 bg-gray-200 rounded animate-pulse w-full" />
                        <div className="h-10 bg-gray-200 rounded animate-pulse w-3/4" />
                      </div>
                    ) : stocks.length === 0 ? (
                      <div className="rounded-md border border-muted px-3 py-2 text-sm text-gray-500">No stock items found for this shop. Add products to stock first.</div>
                    ) : (
                      <select className="block w-full rounded-md border border-input bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-ring" value={formData.shopStockId} onChange={(e) => {
                        const id = e.target.value;
                        const stock = stocks.find(s => s.id === id);
                        const product = stock?.product ?? stock?.Product;
                        const price = product?.price ?? 0;
                        setFormData(prev => ({
                          ...prev,
                          shopStockId: id,
                          productId: stock?.productId ?? prev.productId,
                          unitPrice: price,
                        }));
                      }}>
                        <option value="">Select a product from stock</option>
                        {stocks.map(s => {
                          const product = s.product ?? s.Product;
                          const productName = product?.name ?? 'Unknown Product';
                          const productSku = product?.sku ?? 'N/A';
                          return (
                            <option key={s.id} value={s.id} disabled={s.quantity <= 0}>
                              {productName} — SKU: {productSku} — Stock: {s.quantity} units
                            </option>
                          );
                        })}
                      </select>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Quantity *</Label>
                    <Input type="number" min={1} value={quantityInput} onChange={(e) => setQuantityInput(e.target.value)} onBlur={() => setFormData(prev => ({ ...prev, quantity: parseInt(quantityInput || '1', 10) || 1 }))} />
                  </div>
                  <div>
                    <Label>Unit Price (KES) *</Label>
                    <Input type="number" step="0.01" value={unitPriceInput} onChange={(e) => setUnitPriceInput(e.target.value)} onBlur={() => setFormData(prev => ({ ...prev, unitPrice: parseFloat(unitPriceInput || '0') || 0 }))} />
                    {errors.unitPrice && <p className="text-sm text-red-600 mt-1">{errors.unitPrice}</p>}
                  </div>
                </div>

                <div>
                  <Label>Discount (Amount)</Label>
                  <Input type="number" step="0.01" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} onBlur={() => setFormData(prev => ({ ...prev, discount: parseFloat(discountInput || '0') || 0 }))} />
                </div>

                <div>
                  <Label>Payment Method *</Label>
                  <div className="flex items-center gap-3 mt-2">
                    {['cash', 'mpesa', 'card'].map((method) => {
                      const label = method === 'mpesa' ? 'M-Pesa' : method[0].toUpperCase() + method.slice(1);
                      const active = formData.paymentMethod === method;
                      return (
                        <label key={method} className={`cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-lg border ${active ? `bg-[hsl(var(--primary))] bg-opacity-10 border-[hsl(var(--primary))] ${labelActiveText}` : `${labelBgInactive} border-gray-200 ${labelInactiveText}`}`}>
                          <input type="radio" name="paymentMethod" value={method} checked={active} onChange={() => setFormData({...formData, paymentMethod: method})} className="sr-only" />
                          <span className="text-sm font-medium">{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Customer Name</Label>
                    <Input value={formData.customerName} onChange={(e) => setFormData({...formData, customerName: e.target.value})} />
                  </div>
                  <div>
                    <Label>Customer Phone</Label>
                    <Input value={formData.customerPhone} onChange={(e) => setFormData({...formData, customerPhone: e.target.value})} />
                    {errors.customerPhone && <p className="text-sm text-red-600 mt-1">{errors.customerPhone}</p>}
                  </div>
                </div>

                <div>
                  <Label>Notes</Label>
                  <Input value={formData.notes} onChange={(e) => setFormData({...formData, notes: e.target.value})} />
                </div>

                <div>
                  <p className="text-sm">Total: <strong>{formatCurrency(totalAmount)}</strong></p>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="submit" disabled={submitting} className="flex-1 bg-[hsl(var(--primary))] bg-opacity-10">{submitting ? (editingSaleId ? 'Saving...' : 'Recording sale...') : (editingSaleId ? 'Save changes' : 'Record Sale')}</Button>
                  <Button variant="outline" type="button" onClick={() => router.push('/portal/sales')}>{editingSaleId ? 'Cancel' : 'Back'}</Button>
                </div>
              </form>
            </CardContent>
          </Card>
          </div>

          {/* Right: sidebar (1/3) with Recent Sales and Summary cards */}
          <div className="sm:col-span-1 flex flex-col">
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Recent Sales</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingRecent ? (
                  <div className="space-y-2">
                    <div className="h-6 bg-gray-200 rounded animate-pulse w-full" />
                    <div className="h-6 bg-gray-200 rounded animate-pulse w-5/6" />
                    <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
                  </div>
                ) : recentSales.length === 0 ? (
                  <div className="text-sm text-gray-500">No recent sales to show.</div>
                ) : (
                  <ul className="space-y-3">
                    {recentSales.map((s) => (
                      <li key={s.id} className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">{s.productName ?? 'Product'}</div>
                          <div className="text-xs text-gray-500">Qty: {s.quantity} {s.createdAt ? `• ${new Date(s.createdAt).toLocaleString()}` : ''}</div>
                        </div>
                        <div className="text-sm font-semibold">{formatCurrency(s.totalAmountCents || 0)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Sales Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500">Total sales</div>
                    <div className="text-lg font-semibold">{salesStats.totalSales}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Revenue</div>
                    <div className="text-lg font-semibold">{formatCurrency(salesStats.totalRevenueCents)}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500">Avg items / sale</div>
                    <div className="text-lg font-semibold">{salesStats.avgItemsPerSale}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Change</div>
                    <div className="text-lg font-semibold text-green-600">+0%</div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-500">Summary is based on the most recent results retrieved from the server (limited to the latest items if available).</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
