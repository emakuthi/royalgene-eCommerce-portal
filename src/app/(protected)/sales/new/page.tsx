'use client';

import { roundQuantity } from '@/lib/business-types';
import { useEffect, useRef, useState } from 'react';
import { paymentKind } from '@/lib/payment-breakdown';
import { useSearchParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydratedAuth } from '@/lib/hooks';
import { useBranding } from '@/lib/branding-context';
import { formatMoney } from '@/lib/currency';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import PortalHeader from '@/components/portal/PortalHeader';
import { ImageLightbox } from '@/components/image-lightbox';
import { computePrefillForm } from '@/lib/sales-prefill';
import type { Product } from '@/lib/types';
import { useTheme } from '@/lib/theme-context';
import BarcodeScanInput, { scanBeep } from '@/components/barcode-scan-input';
import { FeatureGate } from '@/components/entitlements/FeatureGate';
import { FeatureCode } from '@/lib/entitlements/feature-codes';
import { v4 as uuidv4 } from 'uuid';
import { Minus, Plus, X } from 'lucide-react';

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

// One product line in a multi-item sale. Lines are recorded together under one saleGroupId.
type CartLine = {
  key: string;
  shopStockId: string;
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  size: string;
  color: string;
  /** Units available when the line was added; caps the quantity. */
  maxQty: number;
};

function lineTotal(l: CartLine) {
  return Math.max(0, l.unitPrice * l.quantity - l.discount);
}

function formatCurrency(amount: number, currency: string = 'KES') {
  return formatMoney(Number(amount), currency);
}

export default function NewSalePage() {
  const cur = useBranding().branding.currency; // tenant base currency
  const [saleCurrency, setSaleCurrency] = useState(cur);
  const [activeCurrencies, setActiveCurrencies] = useState<string[]>([cur]);
  const [baseRate, setBaseRate] = useState(1); // saleCurrency → base rate, for the "≈ base" preview
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
  // False when the sale was recorded by someone else and the caller isn't an
  // owner — the server rejects the save anyway; this just says so up front.
  const [canEditSale, setCanEditSale] = useState(true);
  const [originalPaymentMethod, setOriginalPaymentMethod] = useState<string | null>(null);

  // recent sales + stats
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  // Today's real totals (viewer's local day) + day-over-day revenue change.
  // revenueChangePct is null when yesterday had no sales to compare against.
  const [salesStats, setSalesStats] = useState<{ totalSales: number; totalRevenueCents: number; avgItemsPerSale: number; revenueChangePct: number | null }>(
    { totalSales: 0, totalRevenueCents: 0, avgItemsPerSale: 0, revenueChangePct: null },
  );

  // primary form data - keep numeric canonical values here when possible
  const [formData, setFormData] = useState({
    shopStockId: searchParams?.get('shopStockId') || '',
    productId: searchParams?.get('productId') || '',
    quantity: parseFloat(searchParams?.get('quantity') || '1') || 1,
    unitPrice: Number(searchParams?.get('unitPrice') || '0') || 0,
    discount: Number(searchParams?.get('discount') || '0') || 0,
    paymentMethod: searchParams?.get('paymentMethod') || 'cash',
    customerName: searchParams?.get('customerName') || '',
    customerPhone: searchParams?.get('customerPhone') || '',
    notes: searchParams?.get('notes') || '',
  });

  // string-backed inputs (allow typing partial values like "1.", "", "0.0")
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [quantityInput, setQuantityInput] = useState(String(formData.quantity || 1));
  const [unitPriceInput, setUnitPriceInput] = useState((formData.unitPrice || 0).toFixed(2));
  const [discountInput, setDiscountInput] = useState(String(formData.discount || 0));

  const labelActiveText = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const labelInactiveText = theme === 'dark' ? 'text-gray-300' : 'text-gray-700';
  const labelBgInactive = theme === 'dark' ? 'bg-gray-800' : 'bg-white';

  // Set mounted to true after hydration so store values are available
  useEffect(() => setMounted(true), []);

  // Load active currencies for the sale-currency picker.
  useEffect(() => {
    if (!mounted || !token) return;
    (async () => {
      try {
        const res = await fetch('/api/currencies/active', { headers: { Authorization: `Bearer ${token}` } });
        const j = await res.json();
        if (j?.success && Array.isArray(j.data)) setActiveCurrencies(j.data.map((c: { code: string }) => c.code));
      } catch { /* keep default */ }
    })();
  }, [mounted, token]);

  // Keep the "≈ base" preview rate in sync with the chosen sale currency.
  useEffect(() => {
    if (!token || saleCurrency === cur) { setBaseRate(1); return; }
    (async () => {
      try {
        const res = await fetch(`/api/exchange-rates/${saleCurrency}/${cur}`, { headers: { Authorization: `Bearer ${token}` } });
        const j = await res.json();
        setBaseRate(j?.success && j.data?.rate ? Number(j.data.rate) : 1);
      } catch { setBaseRate(1); }
    })();
  }, [saleCurrency, cur, token]);

  // Switching currency converts the entered unit price (prefill, editable).
  async function changeCurrency(newCur: string) {
    const prev = saleCurrency;
    setSaleCurrency(newCur);
    if (prev === newCur || !token) return;
    try {
      const res = await fetch(`/api/exchange-rates/${prev}/${newCur}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json();
      if (j?.success && j.data?.rate) {
        const v = (parseFloat(unitPriceInput || '0') || 0) * Number(j.data.rate);
        setUnitPriceInput(v.toFixed(2));
      }
    } catch { /* leave as-is */ }
  }

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
              discount: Number(s.discountAmount) || 0,
              // paymentKind folds the app's "M-Pesa"/"Card" spellings in too —
              // an exact match left no option selected for any app sale.
              paymentMethod: paymentKind(s.paymentMethod),
              customerName: s.customerName || '',
              customerPhone: s.customerPhone || '',
              notes: s.notes || '',
            };
            setFormData(newForm);
            setOriginalPaymentMethod(newForm.paymentMethod);
            setCanEditSale(s.canEdit !== false);
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
              // parse images — stored as a text[] in Supabase; may arrive as array or JSON string
              let images: string[] = [];
              if (Array.isArray(maybe['images'])) {
                images = (maybe['images'] as unknown[]).map(String).filter(Boolean);
              } else if (typeof maybe['images'] === 'string') {
                try { images = JSON.parse(maybe['images'] as string); } catch { /* ignore */ }
              }
              productObj = {
                id: String(maybe['id'] ?? ''),
                name: String(maybe['name'] ?? ''),
                price: typeof maybe['price'] === 'number' ? (maybe['price'] as number) : (typeof maybe['price'] === 'string' ? Number(maybe['price']) : undefined),
                sku: String(maybe['sku'] ?? ''),
                description: typeof maybe['description'] === 'string' ? maybe['description'] as string : undefined,
                images,
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

        // Real today-vs-yesterday stats, bounded by the viewer's local midnight.
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);
        const statsRes = await fetch(
          `/api/portal/sales?shopId=${currentShop.id}&limit=5000&from=${encodeURIComponent(yesterdayStart.toISOString())}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const sj = statsRes.ok ? await statsRes.json() : null;
        if (sj?.success && Array.isArray(sj.data)) {
          const amount = (r: Record<string, unknown>) => Number(r.baseAmount ?? r.totalAmount ?? 0) || 0;
          const all = sj.data as Record<string, unknown>[];
          const isToday = (r: Record<string, unknown>) => new Date(String(r.createdAt)).getTime() >= todayStart.getTime();
          const today = all.filter(isToday);
          // Same-time-yesterday, so a half-finished day isn't compared with a full one.
          const sameTimeYesterday = Date.now() - 24 * 60 * 60 * 1000;
          const yesterday = all.filter(r => !isToday(r) && new Date(String(r.createdAt)).getTime() < sameTimeYesterday);
          const totalRevenueCents = today.reduce((acc, r) => acc + amount(r), 0);
          const yesterdayRevenue = yesterday.reduce((acc, r) => acc + amount(r), 0);
          const totalSales = today.length;
          const avgItemsPerSale = totalSales ? Math.round(today.reduce((acc, r) => acc + (Number(r.quantity) || 0), 0) / totalSales) : 0;
          const revenueChangePct = yesterdayRevenue > 0 ? ((totalRevenueCents - yesterdayRevenue) / yesterdayRevenue) * 100 : null;
          setSalesStats({ totalSales, totalRevenueCents, avgItemsPerSale, revenueChangePct });
        }
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
  const parsedQuantity = Math.max(0, roundQuantity(parseFloat(quantityInput || '0') || 0));
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

  // ── Multi-item cart ─────────────────────────────────────────────────────────
  const [cart, setCart] = useState<CartLine[]>([]);
  // Shared by every line of this checkout; renewed once the sale is fully recorded.
  const saleGroupIdRef = useRef<string>(uuidv4());
  const cartTotal = cart.reduce((sum, l) => sum + lineTotal(l), 0);

  // Add a unit (or qty) of an item; the same product/variant merges into one line.
  const addLineToCart = (line: Omit<CartLine, 'key' | 'quantity' | 'discount'>, qty: number): 'added' | 'maxed' => {
    const existing = cart.find(l => l.shopStockId === line.shopStockId && l.size === line.size && l.color === line.color);
    if (existing) {
      const next = roundQuantity(existing.quantity + qty);
      if (next > existing.maxQty) return 'maxed';
      setCart(prev => prev.map(l => (l.key === existing.key ? { ...l, quantity: next } : l)));
      return 'added';
    }
    if (qty > line.maxQty) return 'maxed';
    setCart(prev => [...prev, { ...line, key: uuidv4(), quantity: qty, discount: 0 }]);
    return 'added';
  };

  const updateLine = (key: string, patch: Partial<CartLine>) =>
    setCart(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));

  // A scan adds the item to the sale. Scanning it again adds one more unit, so a cashier can
  // scan a basket item by item. Unknown codes offer to create the product.
  const handleScan = async (code: string) => {
    if (!currentShop?.id || !token) return;
    try {
      const res = await fetch(
        `/api/portal/products/by-barcode?shopId=${encodeURIComponent(currentShop.id)}&code=${encodeURIComponent(code)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const j = await res.json();
      if (!j?.success) {
        scanBeep(false);
        toast.error(j?.error || 'Barcode lookup failed');
        return;
      }
      const hit = j.data as {
        found: boolean;
        product?: { name: string; price: number | null };
        shopStock?: { id: string; quantity: number } | null;
        variant?: { size: string; color: string; quantity: number | null } | null;
      };
      if (!hit.found || !hit.product) {
        scanBeep(false);
        toast.error(`No product found for "${code}"`, {
          action: { label: 'Add product', onClick: () => router.push(`/stock/add-new?barcode=${encodeURIComponent(code)}`) },
        });
        return;
      }
      if (!hit.shopStock) {
        scanBeep(false);
        toast.error(`${hit.product.name} isn't stocked in ${currentShop.name || 'this shop'} yet`);
        return;
      }
      const available = hit.variant?.quantity ?? hit.shopStock.quantity;
      if (available <= 0) {
        scanBeep(false);
        toast.error(`${hit.product.name} is out of stock`);
        return;
      }

      const outcome = addLineToCart(
        {
          shopStockId: hit.shopStock.id,
          productId: stocks.find(st => st.id === hit.shopStock!.id)?.productId ?? '',
          name: hit.product.name,
          unitPrice: typeof hit.product.price === 'number' ? hit.product.price : 0,
          size: hit.variant?.size ?? '',
          color: hit.variant?.color ?? '',
          maxQty: available,
        },
        1,
      );
      if (outcome === 'maxed') {
        scanBeep(false);
        toast.error(`Only ${available} of ${hit.product.name} in stock`);
        return;
      }
      scanBeep(true);
      const variantLabel = hit.variant && (hit.variant.size || hit.variant.color)
        ? ` (${[hit.variant.size, hit.variant.color].filter(Boolean).join(' / ')})`
        : '';
      toast.success(`${hit.product.name}${variantLabel} added`);
    } catch (err) {
      console.error('Barcode scan failed', err);
      scanBeep(false);
      toast.error('Barcode lookup failed');
    }
  };

  // The line currently shown in the form (picked from the dropdown), added to the cart on demand.
  const addFormLineToCart = () => {
    const quantity = Math.max(0, roundQuantity(parseFloat(quantityInput || '0') || 0));
    const unitPrice = parseFloat(unitPriceInput || '0') || 0;
    const discount = parseFloat(discountInput || '0') || 0;
    const stock = stocks.find(st => st.id === formData.shopStockId);
    const product = stock?.product ?? stock?.Product;
    if (!stock || !product) { toast.error('Please select a product from stock'); return; }
    if (quantity <= 0) { toast.error('Quantity must be > 0'); return; }
    if (unitPrice <= 0) { toast.error('Unit price must be greater than 0'); return; }
    const outcome = addLineToCart(
      { shopStockId: stock.id, productId: stock.productId, name: product.name, unitPrice, size: '', color: '', maxQty: stock.quantity },
      quantity,
    );
    if (outcome === 'maxed') { toast.error(`Only ${stock.quantity} of ${product.name} in stock`); return; }
    if (discount > 0) {
      setCart(prev => prev.map(l => (l.shopStockId === stock.id && !l.size && !l.color ? { ...l, discount: l.discount + Math.min(discount, unitPrice * quantity) } : l)));
    }
    setFormData(prev => ({ ...prev, quantity: 1, discount: 0 }));
  };

  // Records every cart line one after another under the shared saleGroupId. If a line fails the
  // lines already recorded are removed from the cart (so a retry can't double-record them) and
  // the rest stay for another attempt.
  const submitCart = async () => {
    if (formData.customerPhone && !isValidPhone(formData.customerPhone)) {
      setErrors({ customerPhone: 'Invalid phone number format' });
      return;
    }
    setErrors({});
    // Lines of the same non-variant product must fit the stock together.
    const perStock = new Map<string, { qty: number; max: number; name: string }>();
    for (const l of cart) {
      if (l.size || l.color) continue;
      const cur0 = perStock.get(l.shopStockId) ?? { qty: 0, max: l.maxQty, name: l.name };
      perStock.set(l.shopStockId, { ...cur0, qty: cur0.qty + l.quantity });
    }
    for (const v of perStock.values()) {
      if (v.qty > v.max) { toast.error(`Only ${v.max} of ${v.name} in stock`); return; }
    }
    if (cart.some(l => l.quantity <= 0 || l.unitPrice <= 0)) {
      toast.error('Every item needs a quantity and a price above 0');
      return;
    }

    setSubmitting(true);
    const paymentMethod = formData.paymentMethod === 'mpesa' ? 'mobile_money' : formData.paymentMethod;
    const total = cart.length;
    const remaining = [...cart];
    try {
      for (const line of cart) {
        const res = await fetch('/api/portal/sales', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            shopId: currentShop?.id,
            shopStockId: line.shopStockId,
            productId: line.productId,
            quantity: line.quantity,
            ...(line.size ? { size: line.size } : {}),
            ...(line.color ? { color: line.color } : {}),
            unitPrice: line.unitPrice,
            discountAmount: Math.min(line.discount, line.unitPrice * line.quantity),
            currency: saleCurrency,
            paymentMethod,
            customerName: formData.customerName || null,
            customerPhone: formData.customerPhone || null,
            notes: formData.notes || null,
            saleGroupId: saleGroupIdRef.current,
          }),
        });
        const j = await res.json();
        if (!j.success) {
          setCart(remaining);
          toast.error(`${line.name}: ${j.error || 'could not be recorded'}. ${total - remaining.length} of ${total} items were recorded; the rest are still in the cart.`);
          return;
        }
        remaining.shift();
      }
      toast.success(total === 1 ? 'Sale recorded' : `Sale recorded (${total} items)`);
      saleGroupIdRef.current = uuidv4();
      setCart([]);
      router.push('/sales');
    } catch (err) {
      console.error('Error recording sale', err);
      setCart(remaining);
      toast.error(`Error recording sale. ${total - remaining.length} of ${total} items were recorded; the rest are still in the cart.`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    // A multi-item sale is recorded from the cart; the single-line form below is only used when it's empty.
    if (!editingSaleId && cart.length > 0) {
      await submitCart();
      return;
    }
    // parse latest typed values into numbers for validation/submission
    const quantity = Math.max(0, roundQuantity(parseFloat(quantityInput || '0') || 0));
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
      const paymentMethod = formData.paymentMethod === 'mpesa' ? 'mobile_money' : formData.paymentMethod;

      if (editingSaleId) {
        const res = await fetch(`/api/portal/sales/${editingSaleId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            quantity,
            unitPrice,
            discountAmount: Math.min(discount, unitPrice * quantity),
            // Only when actually changed: sending it replaces a split payment
            // (Cash + M-Pesa) with the single method shown in the form.
            ...(formData.paymentMethod !== originalPaymentMethod ? { paymentMethod } : {}),
            customerName: formData.customerName || null,
            customerPhone: formData.customerPhone || null,
            notes: formData.notes || null,
          }),
        });
        const j = await res.json();
        if (j.success) {
          toast.success('Sale updated');
          router.push('/sales');
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
            unitPrice,
            discountAmount: Math.min(discount, unitPrice * quantity),
            currency: saleCurrency,
            paymentMethod,
            customerName: formData.customerName || null,
            customerPhone: formData.customerPhone || null,
            notes: formData.notes || null,
          }),
        });
        const j = await res.json();
        if (j.success) {
          toast.success('Sale recorded');
          router.push('/sales');
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
      <PortalHeader backHref="/sales" title={editingSaleId ? 'Edit Sale' : 'Record New Sale'} description="Enter sale details to record a new sale" breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Sales', href: '/portal' }, { label: editingSaleId ? 'Edit' : 'New' }]} />

      {/* Main container uses a responsive grid: single column on small screens, 3 columns on sm+ where form spans 2 cols (2/3) and sidebar 1 col (1/3) */}
      {/* Use full viewport width - remove centered max width so layout uses full available space */}
      <div className="w-full px-4 sm:px-6 py-6 pb-12">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Left: form (2/3) */}
          <div className="sm:col-span-2">
            <Card className="mt-6">
             <CardHeader>
               <CardTitle>{editingSaleId ? (canEditSale ? 'Edit Sale' : 'Sale details') : 'Record New Sale'}</CardTitle>
             </CardHeader>
             <CardContent>
              {editingSaleId && !canEditSale && (
                <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  This sale was recorded by someone else. Only the shop owner can change it — you can view it here.
                </p>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                {!editingSaleId && (
                  <FeatureGate feature={FeatureCode.BARCODE} requiredPlanLabel="Business">
                    <BarcodeScanInput onScan={handleScan} disabled={loadingStocks || submitting || !currentShop?.id} />
                  </FeatureGate>
                )}

                {!editingSaleId && cart.length > 0 && (
                  <div className="rounded-md border border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                      <p className="text-sm font-medium">Items in this sale ({cart.length})</p>
                      <button type="button" disabled={submitting} onClick={() => setCart([])} className="text-xs text-red-600 hover:underline disabled:opacity-50">Clear all</button>
                    </div>
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                      {cart.map((l) => (
                        <li key={l.key} className="flex flex-wrap items-center gap-2 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {l.name}{(l.size || l.color) ? ` (${[l.size, l.color].filter(Boolean).join(' / ')})` : ''}
                            </p>
                            <p className="text-xs text-gray-500">{l.maxQty} in stock</p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button type="button" aria-label="Decrease quantity" disabled={submitting || l.quantity <= 1}
                              onClick={() => updateLine(l.key, { quantity: roundQuantity(l.quantity - 1) })}
                              className="rounded border border-gray-300 p-1 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"><Minus className="h-3.5 w-3.5" /></button>
                            <span className="w-8 text-center text-sm tabular-nums">{l.quantity}</span>
                            <button type="button" aria-label="Increase quantity" disabled={submitting || l.quantity + 1 > l.maxQty}
                              onClick={() => updateLine(l.key, { quantity: roundQuantity(l.quantity + 1) })}
                              className="rounded border border-gray-300 p-1 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:hover:bg-gray-800"><Plus className="h-3.5 w-3.5" /></button>
                          </div>
                          <input type="number" step="0.01" min={0} aria-label={`Unit price for ${l.name}`} disabled={submitting}
                            value={l.unitPrice}
                            onChange={(e) => updateLine(l.key, { unitPrice: parseFloat(e.target.value) || 0 })}
                            className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900" />
                          <span className="w-24 text-right text-sm font-medium tabular-nums">{formatCurrency(lineTotal(l), saleCurrency)}</span>
                          <button type="button" aria-label={`Remove ${l.name}`} disabled={submitting}
                            onClick={() => setCart(prev => prev.filter(x => x.key !== l.key))}
                            className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
                        </li>
                      ))}
                    </ul>
                    <div className="flex items-center justify-between border-t border-gray-200 px-3 py-2 dark:border-gray-700">
                      <span className="text-sm text-gray-600 dark:text-gray-300">Sale total</span>
                      <strong className="text-sm">{formatCurrency(cartTotal, saleCurrency)}</strong>
                    </div>
                  </div>
                )}
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
                      <>
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

                        {/* ── Product image preview ── */}
                        {(() => {
                          const selectedStock = stocks.find(s => s.id === formData.shopStockId);
                          if (!selectedStock) return null;
                          const selectedProduct = selectedStock?.product ?? selectedStock?.Product;
                          if (!selectedProduct) return null;
                          const images: string[] = (selectedProduct as unknown as Record<string, unknown>)?.['images'] as string[] ?? [];
                          const publicImages = images.filter(u => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://')));
                          return (
                            <div className="mt-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">📦 Product Preview</p>
                              <div className="flex items-start gap-3">
                                {/* Main image or placeholder */}
                                {publicImages.length > 0 ? (
                                  <img
                                    src={publicImages[0]}
                                    alt={selectedProduct.name}
                                    onClick={() => setPreviewImageUrl(publicImages[0])}
                                    className="w-24 h-24 rounded-lg object-cover border border-gray-200 dark:border-gray-600 flex-shrink-0 shadow-sm cursor-zoom-in"
                                    onError={(e) => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).className = 'hidden'; }}
                                  />
                                ) : (
                                  <div className="w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex-shrink-0 flex flex-col items-center justify-center bg-gray-100 dark:bg-gray-700/50">
                                    <span className="text-2xl">👗</span>
                                    <span className="text-xs text-gray-400 mt-1">No photo</span>
                                  </div>
                                )}
                                {/* Extra thumbnails */}
                                {publicImages.length > 1 && (
                                  <div className="flex flex-wrap gap-1.5">
                                    {publicImages.slice(1, 5).map((url, i) => (
                                      <img
                                        key={i}
                                        src={url}
                                        alt={`${selectedProduct.name} ${i + 2}`}
                                        onClick={() => setPreviewImageUrl(url)}
                                        className="w-12 h-12 rounded-md object-cover border border-gray-200 dark:border-gray-600 shadow-sm cursor-zoom-in"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                      />
                                    ))}
                                  </div>
                                )}
                                {/* Product info alongside */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate">{selectedProduct.name}</p>
                                  {selectedProduct.sku && <p className="text-xs text-gray-400 mt-0.5">SKU: {selectedProduct.sku}</p>}
                                  {selectedProduct.description && (
                                    <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mt-1">{selectedProduct.description}</p>
                                  )}
                                  <p className="text-xs text-gray-400 mt-1">Stock: <span className="font-medium text-gray-600 dark:text-gray-300">{selectedStock.quantity} units</span></p>
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Quantity *</Label>
                    <Input type="number" min={0} step="any" value={quantityInput} onChange={(e) => setQuantityInput(e.target.value)} onBlur={() => setFormData(prev => ({ ...prev, quantity: roundQuantity(parseFloat(quantityInput || '1') || 1) }))} />
                  </div>
                  {activeCurrencies.length > 1 && (
                    <div>
                      <Label>Sale Currency</Label>
                      <select
                        value={saleCurrency}
                        onChange={(e) => changeCurrency(e.target.value)}
                        disabled={cart.length > 0}
                        title={cart.length > 0 ? 'Clear the cart to change currency' : undefined}
                        className="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm"
                      >
                        {activeCurrencies.map((c) => <option key={c} value={c}>{c}{c === cur ? ' (base)' : ''}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <Label>Unit Price ({saleCurrency}) *</Label>
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
                    {(['cash', 'mpesa', 'card'] as const).map((method) => {
                      const label = method === 'mpesa' ? 'M-Pesa' : method[0].toUpperCase() + method.slice(1);
                      const icon  = method === 'mpesa' ? '📱' : method === 'card' ? '💳' : '💵';
                      const active = formData.paymentMethod === method;
                      const activeCls = method === 'mpesa'
                        ? 'bg-green-600 border-green-600 text-white'
                        : method === 'card'
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-amber-500 border-amber-500 text-white';
                      return (
                        <label
                          key={method}
                          className={`cursor-pointer inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border-2 font-medium text-sm transition-all select-none
                            ${active ? activeCls : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 hover:border-gray-400'}`}
                        >
                          <input type="radio" name="paymentMethod" value={method} checked={active} onChange={() => setFormData({...formData, paymentMethod: method})} className="sr-only" />
                          <span>{icon}</span>
                          <span>{label}</span>
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

                {!editingSaleId && (
                  <div>
                    <Button type="button" variant="outline" onClick={addFormLineToCart} disabled={submitting || !formData.shopStockId}>
                      Add item to sale
                    </Button>
                    {cart.length > 0 && (
                      <p className="mt-1 text-xs text-gray-500">
                        Only the items in the list above are recorded. The product selected here is added when you press &ldquo;Add item to sale&rdquo;.
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <p className="text-sm">{!editingSaleId && cart.length > 0 ? 'Item above' : 'Total'}: <strong>{formatCurrency(totalAmount, saleCurrency)}</strong>
                    {saleCurrency !== cur && baseRate > 0 && (
                      <span className="text-muted-foreground"> · ≈ {formatCurrency(totalAmount * baseRate, cur)}</span>
                    )}
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <Button type="submit" disabled={submitting || (!!editingSaleId && !canEditSale)} className="flex-1 bg-[hsl(var(--primary))] text-white hover:opacity-90">{submitting ? (editingSaleId ? 'Saving...' : 'Recording sale...') : (editingSaleId ? 'Save changes' : (cart.length > 1 ? `Record Sale (${cart.length} items)` : 'Record Sale'))}</Button>
                  <Button variant="outline" type="button" onClick={() => router.push('/sales')}>{editingSaleId ? 'Cancel' : 'Back'}</Button>
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
                        <div className="text-sm font-semibold">{formatCurrency(s.totalAmountCents || 0, cur)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Today&apos;s Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500">Sales today</div>
                    <div className="text-lg font-semibold">{salesStats.totalSales}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Revenue</div>
                    <div className="text-lg font-semibold">{formatCurrency(salesStats.totalRevenueCents, cur)}</div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-gray-500">Avg items / sale</div>
                    <div className="text-lg font-semibold">{salesStats.avgItemsPerSale}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Revenue vs yesterday</div>
                    {salesStats.revenueChangePct === null ? (
                      <div className="text-lg font-semibold text-gray-400">—</div>
                    ) : (
                      <div className={`text-lg font-semibold ${salesStats.revenueChangePct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {salesStats.revenueChangePct >= 0 ? '+' : '−'}{Math.round(Math.abs(salesStats.revenueChangePct))}%
                      </div>
                    )}
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-500">Today so far for this shop, compared with yesterday up to the same time.</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <ImageLightbox src={previewImageUrl} alt="Product" onClose={() => setPreviewImageUrl(null)} />
    </div>
  );
}
