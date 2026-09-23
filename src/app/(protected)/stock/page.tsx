'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import { Search, Eye, ArrowRightLeft, MoreHorizontal, RefreshCw, Grid3x3, Trash2, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ShopStock, Product } from '@/lib/types';
import { formatKESMajor } from '@/lib/format';
import StockViewModal from './stock-view-modal';
import StockTransferModal from './stock-transfer-modal';
import VariantMatrixModal from './variant-matrix-modal';
import * as stockApi from '@/lib/stockApi';
import PortalHeader from '@/components/portal/PortalHeader';
import { useTheme } from '@/lib/theme-context';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import MuiButton from '@mui/material/Button';

// Api row returned by /api/portal/stock (ShopStock with embedded Product and optional shopName)
type ApiShopStock = ShopStock & { Product?: Product; product?: Product; shopName?: string };

// Helper to normalize product embedding from API rows
const getProductFromRow = (row: ApiShopStock): Product | undefined => {
  return (row.product ?? row.Product) as Product | undefined;
};

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

function StockManagementContent() {
  const { token, user: authUser } = useHydratedAuth();
  const { currentShop, _hasHydrated } = usePortalStore();
  const [mounted, setMounted] = useState(false);
  const [stocks, setStocks] = useState<ApiShopStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [shopName, setShopName] = useState('Stock Management');

  // New UI state
  const [isRestockModalOpen, setIsRestockModalOpen] = useState(false);
  const [restockStockId, setRestockStockId] = useState<string | null>(null);
  const [restockQuantity, setRestockQuantity] = useState<number | ''>('');
  const [restocking, setRestocking] = useState(false);
  // View / Edit modal state
  const [isViewModalOpen, setIsViewModalOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<ApiShopStock | null>(null);
  const [viewSaving, setViewSaving] = useState(false);
  const [viewDeleting, setViewDeleting] = useState(false);
  const [deleteStockTarget, setDeleteStockTarget] = useState<{ stockId: string; productId: string; name: string } | null>(null);
  // Transfer modal state
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferStock, setTransferStock] = useState<ApiShopStock | null>(null);
  // Size/colour breakdown modal state
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  const [variantStock, setVariantStock] = useState<ApiShopStock | null>(null);
  // Tab state: 'current' = current shop only, 'all' = all shops
  const [activeTab, setActiveTab] = useState<'current' | 'all'>('current');
  const [allStocks, setAllStocks] = useState<ApiShopStock[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  // Bulk selection/delete (admins only — see isAdmin below). Keyed by Product.id,
  // not ShopStock.id: a bulk delete removes the PRODUCT from every shop (same
  // as the existing single-delete's admin path), and the "All Products" tab
  // can show the same product across several shop rows, which should count
  // and select as one.
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  // Local editable form for the view modal (product + stock fields)
  const [viewForm, setViewForm] = useState<ViewFormType>({
    name: '',
    sku: '',
    description: '',
    costPrice: '',
    sellingPrice: '',
    sizes: [] as string[],
    colors: [] as string[],
    images: [] as string[],
    quantity: 0,
    lowStockThreshold: 5,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !token || !_hasHydrated) return;

    // New behavior: when we have currentShop, fetch stocks for that shop
    const fetchAllShopStocks = async () => {
      setLoading(true);
      try {
        // Use currentShop if available; otherwise fetch shops and use the first one
        let shopIdToUse = currentShop?.id ?? null;

        // If no currentShop, fetch available shops and use the first one
        if (!shopIdToUse) {
          console.debug('[StockPage] currentShop is null, fetching available shops');
          try {
            const shopsRes = await fetch('/api/portal/shops', { headers: { Authorization: `Bearer ${token}` } });
            if (shopsRes.ok) {
              const shopsJson = await shopsRes.json();
              if (shopsJson.success && Array.isArray(shopsJson.data) && shopsJson.data.length > 0) {
                const firstShop = shopsJson.data[0];
                shopIdToUse = firstShop.id;
                setShopName(firstShop.name ?? 'Stock Management');
                console.debug('[StockPage] using first available shop:', shopIdToUse);
              }
            }
          } catch (err) {
            console.warn('[StockPage] failed to fetch shops for fallback', err);
          }
        }

        if (!shopIdToUse) {
          setStocks([]);
          setShopName('Stock Management');
          setLoading(false);
          return;
        }

        console.debug('[StockPage] fetching stocks for shopId=', shopIdToUse);
        const response = await fetch(`/api/portal/stock?shopId=${shopIdToUse}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
          const txt = await response.text();
          console.warn('[StockPage] stocks fetch failed with status', response.status, txt);
          toast.error('Failed to load stock data');
          setStocks([]);
          setLoading(false);
          return;
        }
        const json = await response.json();
        if (json.success) {
          const enriched = (json.data || []).map((row: ApiShopStock) => ({ ...row, shopName: currentShop?.name }));
          // Normalize each row to ensure `product` exists (Supabase may embed as `Product`)
          const normalizedEnriched = enriched.map((r: ApiShopStock) => ({ ...r, product: r.Product ?? r.product }));
          setStocks(normalizedEnriched);
          if (!currentShop?.name) setShopName('Stock Management');
        } else {
          console.warn('[StockPage] stocks API returned success=false', json);
          toast.error(json.error || 'Failed to load stock data');
          setStocks([]);
        }
      } catch (error) {
        console.error('Failed to fetch stocks:', error);
        toast.error('Failed to load stock data');
        setStocks([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAllShopStocks();
  }, [mounted, currentShop, token, authUser?.role, _hasHydrated]);

  // Fetch all stocks for the "All Products" tab
  useEffect(() => {
    if (!mounted || !token || !_hasHydrated) return;
    if (activeTab !== 'all') return; // Only fetch when tab is active

    const fetchAllStocks = async () => {
      setLoadingAll(true);
      try {
        const response = await fetch('/api/portal/stock?all=true', { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
          const txt = await response.text();
          console.warn('[StockPage] all stocks fetch failed with status', response.status, txt);
          toast.error('Failed to load all stock data');
          setAllStocks([]);
          return;
        }
        const json = await response.json();
        if (json.success) {
          const normalizedEnriched = (json.data || []).map((r: ApiShopStock) => ({ ...r, product: r.Product ?? r.product }));
          setAllStocks(normalizedEnriched);
        } else {
          console.warn('[StockPage] all stocks API returned success=false', json);
          toast.error(json.error || 'Failed to load all stock data');
          setAllStocks([]);
        }
      } catch (error) {
        console.error('Failed to fetch all stocks:', error);
        toast.error('Failed to load all stock data');
        setAllStocks([]);
      } finally {
        setLoadingAll(false);
      }
    };

    fetchAllStocks();
  }, [mounted, token, authUser?.role, _hasHydrated, activeTab]);

  // A selection made on one tab shouldn't silently carry over (and confuse a
  // "N selected" count) once the visible rows change out from under it.
  useEffect(() => { setSelectedProductIds(new Set()); }, [activeTab]);

  // Deletion is admin-only (same rule as the mobile app's bulk delete) —
  // the single-item delete button stays visible to everyone and lets the
  // server enforce it, but bulk delete has no such per-row confirmation
  // step to lean on, so it's worth gating the controls themselves too.
  const isAdmin = authUser?.role === 'admin' || authUser?.role === 'super_admin';

  // Accurate, variant-aware stock value — the same source the Android app's
  // and the web Analytics page's own Inventory card already use (see
  // GET /api/portal/analytics/inventory). Admin-only (that route is), fetched
  // once and reused for both tabs below, rather than recomputed from a flat
  // `quantity × product.price` here, which silently ignored a variant cell's
  // own price override and — separately — was always scoped to the CURRENT
  // shop's `stocks`, never updating when switching to the "All Products" tab.
  const [inventoryValue, setInventoryValue] = useState<{ totalUnits: number; totalRetailValue: number; shops: Array<{ shopId: string; units: number; retailValue: number }> } | null>(null);
  useEffect(() => {
    if (!mounted || !_hasHydrated || !token || !isAdmin) return;
    (async () => {
      try {
        const res = await fetch('/api/portal/analytics/inventory', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const json = await res.json();
        if (res.ok && json.success) setInventoryValue(json.data);
      } catch (err) {
        console.error('Failed to fetch inventory value:', err);
      }
    })();
  }, [mounted, _hasHydrated, token, isAdmin]);

  // Derived metrics used by the new UI — scoped to whichever tab is active,
  // so switching to "All Products" actually changes these numbers instead of
  // silently staying locked to the current shop's own stock.
  const metrics = useMemo(() => {
    const rows = activeTab === 'current' ? stocks : allStocks;
    // Total UNITS in stock (not distinct products) — matches the Android
    // Analytics screen's own Inventory card ("Total items"). quantity is
    // already the correctly rolled-up total for a variant product (kept in
    // sync by a DB trigger), so this needs no per-cell awareness the way
    // stockValue below does.
    const totalItems = rows.reduce((sum, s: ShopStock & { product?: Product }) => sum + (Number(s.quantity) || 0), 0);
    const lowStock = rows.filter((s: ShopStock & { product?: Product }) => s.quantity <= s.lowStockThreshold).length;
    const outOfStock = rows.filter((s: ShopStock & { product?: Product }) => s.quantity === 0).length;

    let stockValue: number;
    if (inventoryValue) {
      stockValue = activeTab === 'current' && currentShop
        ? (inventoryValue.shops.find(s => s.shopId === currentShop.id)?.retailValue ?? 0)
        : inventoryValue.totalRetailValue;
    } else {
      // Fallback for a non-admin (that endpoint is admin-only) or while it's
      // still loading — the same flat calculation as before, imprecise for a
      // variant product's own per-cell price but otherwise reasonable.
      stockValue = rows.reduce((sum, s: ShopStock & { product?: Product }) => {
        const price = Number(s.product?.price ?? 0);
        const qty = Number(s.quantity || 0);
        return sum + price * qty;
      }, 0);
    }

    return { totalItems, stockValue, lowStock, outOfStock };
  }, [stocks, allStocks, activeTab, inventoryValue, currentShop]);

  const filteredStocks = (activeTab === 'current' ? stocks : allStocks).filter(stock =>
    (stock.product?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (stock.product?.sku || '').toLowerCase().includes(searchQuery.toLowerCase())
  );
  // Every currently-visible product id, deduplicated — the "All Products" tab
  // can show the same product across several shop rows.
  const selectableProductIds = useMemo(
    () => Array.from(new Set(filteredStocks.map(s => getProductFromRow(s)?.id).filter((id): id is string => Boolean(id)))),
    [filteredStocks]
  );
  const allVisibleSelected = selectableProductIds.length > 0 && selectableProductIds.every(id => selectedProductIds.has(id));
  const someVisibleSelected = selectableProductIds.some(id => selectedProductIds.has(id));

  const toggleSelectAllVisible = () => {
    // Toggle, not a one-way "select all": once everything visible is already
    // selected, clicking it again clears the selection instead of just
    // reassigning the same set (which would look like it did nothing).
    setSelectedProductIds(allVisibleSelected ? new Set() : new Set(selectableProductIds));
  };
  const toggleOneSelected = (productId: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  };
  // Names for the confirmation dialog — looked up from whichever list (either
  // tab) actually has the row, since a selection can in principle span both.
  const selectedProductNames = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of [...stocks, ...allStocks]) {
      const p = getProductFromRow(s);
      if (p?.id && selectedProductIds.has(p.id) && !byId.has(p.id)) byId.set(p.id, p.name || 'Unknown product');
    }
    return Array.from(selectedProductIds).map(id => byId.get(id) || 'Unknown product');
  }, [selectedProductIds, stocks, allStocks]);

  const confirmBulkDeleteAction = async () => {
    setConfirmBulkDelete(false);
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedProductIds);
      const res = await stockApi.bulkDeleteProducts(token, ids);
      if (!res.ok || !res.json.success) {
        toast.error(res.json.error || 'Failed to delete products');
        return;
      }
      const removedIds = new Set<string>([...(res.json.data?.deleted ?? []), ...(res.json.data?.archived ?? [])]);
      setStocks(prev => prev.filter(s => !removedIds.has(getProductFromRow(s)?.id ?? '')));
      setAllStocks(prev => prev.filter(s => !removedIds.has(getProductFromRow(s)?.id ?? '')));
      setSelectedProductIds(new Set());
      toast.success(res.json.message || `${removedIds.size} removed`);
    } catch (err) {
      console.error('Bulk delete error', err);
      toast.error('Failed to delete products');
    } finally {
      setBulkDeleting(false);
    }
  };

  // Theme-aware classes for table and text
  const { theme } = useTheme();
  const tableBg = theme === 'dark' ? 'bg-gray-800' : 'bg-white';
  const textPrimary = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const muted = theme === 'dark' ? 'text-gray-400' : 'text-gray-500';
  const tableBorder = theme === 'dark' ? 'border-gray-700' : 'border-gray-200';

  if (!mounted || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className={`${muted}`}>Loading...</p>
        </div>
      </div>
    );
  }

  // For portal users, require a shop context
  if (authUser?.role === 'portal_user' && !currentShop) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className={`${muted}`}>Loading shop information...</p>
      </div>
    );
  }

  // View / Edit modal handlers
  const openViewModal = (stock: ApiShopStock) => {
    const prod = getProductFromRow(stock) ?? null;
    setSelectedStock(stock);
    setViewForm({
      name: prod?.name ?? '',
      sku: prod?.sku ?? '',
      description: prod?.description ?? '',
      costPrice: prod?.costPrice != null ? String(prod.costPrice) : '',
      sellingPrice: prod?.price != null ? String(prod.price) : '',
      sizes: prod?.sizes ?? [],
      colors: prod?.colors ?? [],
      images: prod?.images ?? [],
      quantity: stock.quantity ?? 0,
      lowStockThreshold: stock.lowStockThreshold ?? 5,
    });
    setIsViewModalOpen(true);
  };

  const closeViewModal = () => {
    setIsViewModalOpen(false);
    setSelectedStock(null);
  };

  const handleAddViewImage = (url: string) => setViewForm(prev => ({ ...prev, images: [...prev.images, url] }));
  const handleRemoveViewImage = (url: string) => setViewForm(prev => ({ ...prev, images: prev.images.filter(u => u !== url) }));

  // Handlers delegated to StockViewModal via props using helpers in src/lib/stockApi
  const handleSaveView = async (stockId: string, productPayload: Record<string, unknown>, stockPayload: Record<string, unknown>) => {
    setViewSaving(true);
    try {
      const prodRes = await stockApi.updateProduct(token, productPayload);
      if (!prodRes.ok || !prodRes.json.success) {
        toast.error(prodRes.json.error || 'Failed to update product');
      }

      const stockRes = await stockApi.updateStock(token, stockPayload);
      if (!stockRes.ok || !stockRes.json.success) {
        toast.error(stockRes.json.error || 'Failed to update stock');
        return false;
      }

      // Update local state with returned stock data if provided
      const updatedQty = stockRes.json.data?.quantity ?? (stockPayload.quantity as number);
      setStocks(prev => prev.map(s => s.id === stockId ? ({
        ...s,
        quantity: updatedQty,
        lowStockThreshold: (stockPayload.lowStockThreshold as number) ?? s.lowStockThreshold,
        product: { ...(s.product ?? s.Product ?? {}), ...(productPayload as Partial<Product>) }
      } as ApiShopStock) : s));
      toast.success('Product & stock updated');
      return true;
    } catch (err) {
      console.error('Save view error', err);
      toast.error('Failed to save changes');
      return false;
    } finally {
      setViewSaving(false);
    }
  };

  const handleDeleteFromView = async (stockId: string, productId?: string) => {
    if (!productId) { toast.error('Product ID missing'); return false; }
    setDeleteStockTarget({ stockId, productId, name: productId });
    return false;
  };

  const confirmDeleteFromView = async () => {
    if (!deleteStockTarget) return;
    const { stockId, productId } = deleteStockTarget;
    setDeleteStockTarget(null);
    setViewDeleting(true);
    try {
      const delRes = await stockApi.deleteProduct(token, productId);
      if (!delRes.ok || !delRes.json.success) {
        toast.error(delRes.json.error || 'Failed to delete product');
        return false;
      }
      setStocks(prev => prev.filter(s => s.id !== stockId));
      if (delRes.json.data?.deactivated) {
        toast.success(delRes.json.message || 'Product has sales history, so it was archived instead of deleted.');
      } else {
        toast.success('Product deleted');
      }
      return true;
    } catch (err) {
      console.error('Delete error', err);
      toast.error('Failed to delete product');
      return false;
    } finally {
      setViewDeleting(false);
    }
  };

  return (
    <div className="w-full bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <PortalHeader
        backHref="/dashboard"
        title="Inventory Management"
        description="Manage stock levels and products across all outlets"
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Stock' }]}
        actions={(
          <div className="flex items-center gap-3">
            <Button variant="ghost">Export</Button>
            <Button variant="ghost">Filter</Button>
            <Link href="/stock/add-new">
              <Button className="bg-[hsl(var(--primary))] text-white hover:brightness-90">+ Add Product</Button>
            </Link>
          </div>
        )}
      />

      <div className="px-4 sm:px-2 py-2 pb-4 w-full space-y-6">
        {/* Top metric cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <CardContent>
              <p className="text-sm text-gray-500">Total Items</p>
              <h2 className="text-2xl font-bold">{metrics.totalItems.toLocaleString('en-KE')}</h2>
              <p className="text-xs text-gray-400">{activeTab === 'current' ? 'Units in this shop' : 'Units across all shops'}</p>
            </CardContent>
          </Card>

          <Card className="p-4">
            <CardContent>
              <p className="text-sm text-gray-500">Stock Value</p>
              <h2 className="text-2xl font-bold">{formatKESMajor(metrics.stockValue)}</h2>
              <p className="text-xs text-gray-400">Total inventory value</p>
            </CardContent>
          </Card>

          <Card className="p-4">
            <CardContent>
              <p className="text-sm text-gray-500">Low Stock</p>
              <h2 className="text-2xl font-bold text-amber-600">{metrics.lowStock}</h2>
              <p className="text-xs text-gray-400">Items need attention</p>
            </CardContent>
          </Card>

          <Card className="p-4">
            <CardContent>
              <p className="text-sm text-gray-500">Out of Stock</p>
              <h2 className="text-2xl font-bold text-red-600">{metrics.outOfStock}</h2>
              <p className="text-xs text-gray-400">Urgent restocking needed</p>
            </CardContent>
          </Card>
        </div>
        {/* Current Stock Table area */}
        <div className={`${tableBg} p-4 rounded shadow-sm`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <Button
                variant={activeTab === 'current' ? 'default' : 'ghost'}
                onClick={() => { setActiveTab('current'); setSearchQuery(''); }}
                className="transition-colors"
              >
                Current Stock
              </Button>
              <Button
                variant={activeTab === 'all' ? 'default' : 'ghost'}
                onClick={() => { setActiveTab('all'); setSearchQuery(''); }}
                className="transition-colors"
              >
                All Products
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className={`absolute left-3 top-3 h-4 w-4 ${muted}`} />
                <Input placeholder="Search product or SKU" className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Bulk selection toolbar — admins only, appears once something is selected */}
          {isAdmin && selectedProductIds.size > 0 && (
            <div className="flex items-center justify-between mb-4 px-4 py-2.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
              <span className={`text-sm font-medium ${textPrimary}`}>{selectedProductIds.size} selected</span>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelectedProductIds(new Set())} className="gap-1.5">
                  <X className="h-3.5 w-3.5" />Clear
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmBulkDelete(true)}
                  disabled={bulkDeleting}
                  className="gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {bulkDeleting ? 'Deleting…' : 'Delete selected'}
                </Button>
              </div>
            </div>
          )}

          {/* Loading state for All Products tab */}
          {activeTab === 'all' && loadingAll && (
            <div className="flex justify-center py-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          )}

          {/* ── Mobile card grid (< md) ── */}
          {!(activeTab === 'all' && loadingAll) && (
          <>
          <div className="block md:hidden space-y-3">
            {isAdmin && filteredStocks.length > 0 && (
              // Deliberately NOT one clickable wrapper around the checkbox: MUI's
              // Checkbox already fires its own onChange on a direct tap, and a
              // wrapping onClick would fire too (bubbling), double-toggling it
              // back off on the same tap. The checkbox and the label text each
              // get their own, non-overlapping click target instead.
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Checkbox
                  checked={allVisibleSelected}
                  indeterminate={!allVisibleSelected && someVisibleSelected}
                  size="small"
                  className="-ml-2"
                  onChange={toggleSelectAllVisible}
                />
                <button type="button" onClick={toggleSelectAllVisible} className={textSecondary}>
                  {allVisibleSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
            )}
            {filteredStocks.length === 0 && (
              <div className={`text-center py-8 ${muted}`}>{stocks.length === 0 ? 'No stock items found' : 'No matching items'}</div>
            )}
            {filteredStocks.map((stock) => {
              const isLow = stock.quantity <= stock.lowStockThreshold;
              const productWithCost = stock.product as (Product & { costPrice?: number }) | undefined;
              const sellPrice = Number(productWithCost?.price ?? 0);
              const costPrice = Number(productWithCost?.costPrice ?? sellPrice);
              const cardProductId = getProductFromRow(stock)?.id;
              const cardSelected = Boolean(cardProductId && selectedProductIds.has(cardProductId));
              return (
                <div
                  key={stock.id}
                  className={`rounded-xl border ${tableBorder} p-4 flex flex-col gap-3 shadow-sm ${cardSelected ? (theme === 'dark' ? 'bg-purple-900/10 border-purple-700' : 'bg-purple-50 border-purple-300') : tableBg}`}
                >
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {isAdmin && (
                        <Checkbox
                          checked={cardSelected}
                          onChange={() => cardProductId && toggleOneSelected(cardProductId)}
                          disabled={!cardProductId}
                          size="small"
                          aria-label={`Select ${stock.product?.name || 'product'}`}
                          className="-ml-2 -mt-1"
                        />
                      )}
                      <div>
                        <p className={`font-semibold text-sm ${textPrimary}`}>{stock.product?.name || 'Unknown'}</p>
                        <p className={`text-xs ${muted}`}>{stock.shopName ?? shopName}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isLow ? (theme === 'dark' ? 'bg-amber-900 text-amber-300' : 'bg-amber-100 text-amber-800') : (theme === 'dark' ? 'bg-emerald-900 text-emerald-300' : 'bg-emerald-100 text-emerald-800')}`}>
                        {isLow ? 'low' : 'in stock'}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0" title="Actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => openViewModal(stock)} className="cursor-pointer gap-2">
                            <Eye className="h-4 w-4 text-gray-500" />View / Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => { setTransferStock(stock); setIsTransferModalOpen(true); }}
                            className="cursor-pointer gap-2 text-blue-600 focus:text-blue-600 dark:text-blue-400"
                          >
                            <ArrowRightLeft className="h-4 w-4" />Transfer Stock
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => { setVariantStock(stock); setIsVariantModalOpen(true); }}
                            className="cursor-pointer gap-2"
                          >
                            <Grid3x3 className="h-4 w-4 text-gray-500" />Size / colour breakdown
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => { setRestockStockId(stock.id); setIsRestockModalOpen(true); setRestockQuantity(stock.quantity); }}
                            className="cursor-pointer gap-2"
                          >
                            <RefreshCw className="h-4 w-4 text-gray-500" />Restock
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {/* Stats grid */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-2">
                      <p className={`text-xs ${muted}`}>Stock</p>
                      <p className={`font-bold text-sm ${textPrimary}`}>{stock.quantity}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-2">
                      <p className={`text-xs ${muted}`}>Min Level</p>
                      <p className={`font-bold text-sm ${textPrimary}`}>{stock.lowStockThreshold}</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-2">
                      <p className={`text-xs ${muted}`}>Reserved</p>
                      <p className={`font-bold text-sm ${textPrimary}`}>0</p>
                    </div>
                  </div>

                  {/* Prices */}
                  <div className={`flex justify-between text-xs ${textSecondary} border-t ${tableBorder} pt-2`}>
                    <span>Cost: <span className="font-semibold">{formatKESMajor(costPrice)}</span></span>
                    <span>Sell: <span className="font-semibold">{formatKESMajor(sellPrice)}</span></span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop table (≥ md) ── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={`text-left text-xs ${muted} border-b ${tableBorder}`}>
                <tr>
                  {isAdmin && (
                    <th className="py-3 px-2 w-10">
                      <Checkbox
                        checked={allVisibleSelected}
                        indeterminate={!allVisibleSelected && someVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        size="small"
                        aria-label={allVisibleSelected ? 'Deselect all' : 'Select all'}
                      />
                    </th>
                  )}
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Shop</th>
                  <th className="py-3 px-4 text-center">Current Stock</th>
                  <th className="py-3 px-4 text-center">Available</th>
                  <th className="py-3 px-4 text-center">Reserved</th>
                  <th className="py-3 px-4 text-center">Min Level</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Cost Value</th>
                  <th className="py-3 px-4 text-center">Sell Value</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStocks.map(stock => {
                  const available = stock.quantity; // placeholder: available = quantity - reserved (if reserved existed)
                  const reserved = 0;
                  const isLow = stock.quantity <= stock.lowStockThreshold;
                  // price values are stored in major units (KES), no conversion needed
                  const productWithCost = stock.product as (Product & { costPrice?: number }) | undefined;
                  const sellPrice = Number(productWithCost?.price ?? 0);
                  const costPrice = Number(productWithCost?.costPrice ?? sellPrice);
                  const rowProductId = getProductFromRow(stock)?.id;

                  return (
                    <tr key={stock.id} className={`border-b ${tableBorder} ${rowProductId && selectedProductIds.has(rowProductId) ? (theme === 'dark' ? 'bg-purple-900/10' : 'bg-purple-50') : ''}`}>
                      {isAdmin && (
                        <td className="py-3 px-2">
                          <Checkbox
                            checked={Boolean(rowProductId && selectedProductIds.has(rowProductId))}
                            onChange={() => rowProductId && toggleOneSelected(rowProductId)}
                            disabled={!rowProductId}
                            size="small"
                            aria-label={`Select ${stock.product?.name || 'product'}`}
                          />
                        </td>
                      )}
                      <td className="py-3 px-4">
                        <div className={`font-medium ${textPrimary}`}>{stock.product?.name || 'Unknown'}</div>
                      </td>
                      <td className={`py-3 px-4 ${textSecondary}`}>{stock.shopName ?? shopName}</td>
                      <td className="py-3 px-4 text-center font-semibold">{stock.quantity}</td>
                      <td className="py-3 px-4 text-center">{available}</td>
                      <td className="py-3 px-4 text-center">{reserved}</td>
                      <td className="py-3 px-4 text-center">{stock.lowStockThreshold}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2 py-1 rounded-full text-xs ${isLow ? (theme === 'dark' ? 'bg-amber-900 text-amber-300' : 'bg-amber-100 text-amber-800') : (theme === 'dark' ? 'bg-emerald-900 text-emerald-300' : 'bg-emerald-100 text-emerald-800')}`}>{isLow ? 'low' : 'in stock'}</span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-semibold">{formatKESMajor(costPrice)}</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-semibold">{formatKESMajor(sellPrice)}</div>
                      </td>
                        <td className="py-3 px-4 text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" title="Actions">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => openViewModal(stock)} className="cursor-pointer gap-2">
                                <Eye className="h-4 w-4 text-gray-500" />
                                View / Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => { setTransferStock(stock); setIsTransferModalOpen(true); }}
                                className="cursor-pointer gap-2 text-blue-600 focus:text-blue-600 dark:text-blue-400"
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                                Transfer Stock
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => { setVariantStock(stock); setIsVariantModalOpen(true); }}
                                className="cursor-pointer gap-2"
                              >
                                <Grid3x3 className="h-4 w-4 text-gray-500" />
                                Size / colour breakdown
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => { setRestockStockId(stock.id); setIsRestockModalOpen(true); setRestockQuantity(stock.quantity); }}
                                className="cursor-pointer gap-2"
                              >
                                <RefreshCw className="h-4 w-4 text-gray-500" />
                                Restock
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredStocks.length === 0 && (
              <div className={`text-center py-8 ${muted}`}>{stocks.length === 0 ? 'No stock items found' : 'No matching items'}</div>
            )}
          </div>{/* end desktop table wrapper */}
          </>
          )}{/* end loadingAll guard */}
        </div>
      </div>

      {/* Restock Modal */}
      {isRestockModalOpen && restockStockId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-lg w-full max-w-md p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Restock Item</h3>
              <Button variant="ghost" onClick={() => { setIsRestockModalOpen(false); setRestockStockId(null); setRestockQuantity(''); }}>Close</Button>
            </div>
            <div className="mt-4">
              <label className={`block text-sm ${textSecondary}`}>Quantity to set</label>
              <Input type="number" value={restockQuantity} onChange={(e) => setRestockQuantity(e.target.value === '' ? '' : Number(e.target.value))} placeholder="Enter new stock quantity" />
              <div className="flex items-center justify-end gap-3 mt-4">
                <Button variant="outline" onClick={() => { setIsRestockModalOpen(false); setRestockStockId(null); setRestockQuantity(''); }}>Cancel</Button>
                <Button onClick={async () => {
                  if (restockQuantity === '' || restockQuantity < 0) { toast.error('Enter a valid quantity'); return; }
                  setRestocking(true);
                  try {
                    const res = await fetch('/api/portal/stock', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ stockId: restockStockId, quantity: restockQuantity }) });
                    const json = await res.json();
                    if (!res.ok || !json.success) { toast.error(json.error || 'Failed to restock'); setRestocking(false); return; }
                    // update local stocks
                    setStocks(prev => prev.map(s => s.id === restockStockId ? { ...s, quantity: json.data.quantity } : s));
                    toast.success('Stock updated');
                    setIsRestockModalOpen(false);
                    setRestockStockId(null);
                    setRestockQuantity('');
                  } catch (err) {
                    console.error('Restock error', err);
                    toast.error('Failed to restock');
                  } finally {
                    setRestocking(false);
                  }
                }} className="bg-[hsl(var(--primary))] text-white" disabled={restocking}>{restocking ? 'Saving...' : 'Save'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* View / Edit Modal */}
      {isViewModalOpen && selectedStock && (
        <StockViewModal
          stock={selectedStock}
          open={isViewModalOpen}
          onClose={() => { if (!viewSaving && !viewDeleting) closeViewModal(); }}
          viewForm={viewForm}
          setViewForm={setViewForm}
          onImageAdd={handleAddViewImage}
          onImageRemove={handleRemoveViewImage}
          onSave={handleSaveView}
          onDelete={handleDeleteFromView}
          saving={viewSaving}
          deleting={viewDeleting}
        />
      )}

      {/* Delete Product Confirmation Modal */}
      <Dialog open={Boolean(deleteStockTarget)} onClose={() => !viewDeleting && setDeleteStockTarget(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>🗑️ Delete Product</DialogTitle>
        <DialogContent>
          <DialogContentText>Are you sure you want to delete this product? This will remove it from the selected shop and cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <MuiButton onClick={() => setDeleteStockTarget(null)} variant="outlined" size="small" disabled={viewDeleting}>Cancel</MuiButton>
          <MuiButton onClick={() => void confirmDeleteFromView()} variant="contained" size="small" disabled={viewDeleting} sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>{viewDeleting ? 'Deleting…' : 'Delete'}</MuiButton>
        </DialogActions>
      </Dialog>

      {/* Bulk Delete Confirmation Modal */}
      <Dialog open={confirmBulkDelete} onClose={() => !bulkDeleting && setConfirmBulkDelete(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>
          🗑️ {selectedProductIds.size === 1 ? 'Delete this product?' : `Delete ${selectedProductIds.size} products?`}
        </DialogTitle>
        <DialogContent>
          <ul className="list-disc pl-5 text-sm space-y-0.5 mb-2">
            {selectedProductNames.slice(0, 5).map((name, i) => <li key={i} className="truncate">{name}</li>)}
          </ul>
          {selectedProductNames.length > 5 && (
            <p className={`text-xs ${muted} mb-2`}>…and {selectedProductNames.length - 5} more</p>
          )}
          <DialogContentText>
            This removes {selectedProductIds.size === 1 ? 'it' : 'them'} from every shop, along with the stock counts.
            A product that already has sales will be archived instead, so your sales history stays intact.
            This can’t be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <MuiButton onClick={() => setConfirmBulkDelete(false)} variant="outlined" size="small" disabled={bulkDeleting}>Cancel</MuiButton>
          <MuiButton onClick={() => void confirmBulkDeleteAction()} variant="contained" size="small" disabled={bulkDeleting} sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>{bulkDeleting ? 'Deleting…' : 'Delete'}</MuiButton>
        </DialogActions>
      </Dialog>

      {/* Stock Transfer Modal */}
      <StockTransferModal
        open={isTransferModalOpen}
        stock={transferStock}
        currentShopId={currentShop?.id ?? ''}
        token={token}
        onClose={() => { setIsTransferModalOpen(false); setTransferStock(null); }}
        onTransferred={(stockId, newQty) => {
          setStocks(prev => prev.map(s => s.id === stockId ? { ...s, quantity: newQty } : s));
        }}
      />

      {/* Size / colour breakdown modal */}
      {isVariantModalOpen && variantStock && (
        <VariantMatrixModal
          open={isVariantModalOpen}
          stock={variantStock}
          token={token}
          onClose={() => { setIsVariantModalOpen(false); setVariantStock(null); }}
          onSaved={(stockId, newTotal) => {
            setStocks(prev => prev.map(s => s.id === stockId ? { ...s, quantity: newTotal } : s));
            setAllStocks(prev => prev.map(s => s.id === stockId ? { ...s, quantity: newTotal } : s));
          }}
        />
      )}
    </div>
  );
}

export default function StockManagementPage() {
  return <StockManagementContent />;
}
