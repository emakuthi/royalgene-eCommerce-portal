'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import { Search, Eye } from 'lucide-react';
import type { ShopStock, Product } from '@/lib/types';
import { formatKESMajor } from '@/lib/format';
import StockViewModal from './stock-view-modal';
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

  // Derived metrics used by the new UI
  const metrics = useMemo(() => {
    const totalProducts = stocks.length;
    // Compute total stock value (price stored in major units)
    const stockValue = stocks.reduce((sum, s: ShopStock & { product?: Product }) => {
      const price = Number(s.product?.price ?? 0);
      const qty = Number(s.quantity || 0);
      return sum + price * qty;
    }, 0);
    const lowStock = stocks.filter((s: ShopStock & { product?: Product }) => s.quantity <= s.lowStockThreshold).length;
    const outOfStock = stocks.filter((s: ShopStock & { product?: Product }) => s.quantity === 0).length;

    return { totalProducts, stockValue, lowStock, outOfStock };
  }, [stocks]);

  const filteredStocks = stocks.filter(stock =>
    (stock.product?.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (stock.product?.sku || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

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
      toast.success('Product deleted');
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
              <p className="text-sm text-gray-500">Total Products</p>
              <h2 className="text-2xl font-bold">{metrics.totalProducts}</h2>
              <p className="text-xs text-gray-400">Active products</p>
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
              <Button variant="outline">Current Stock</Button>
              <Button variant="ghost">All Products</Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className={`absolute left-3 top-3 h-4 w-4 ${muted}`} />
                <Input placeholder="Search product or SKU" className="pl-10" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={`text-left text-xs ${muted} border-b ${tableBorder}`}>
                <tr>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">SKU</th>
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

                  return (
                    <tr key={stock.id} className={`border-b ${tableBorder}`}>
                      <td className="py-3 px-4">
                        <div className={`font-medium ${textPrimary}`}>{stock.product?.name || 'Unknown'}</div>
                        <div className={`text-xs ${muted}`}>{stock.product?.description || ''}</div>
                      </td>
                      <td className={`py-3 px-4 ${textSecondary}`}>{stock.product?.sku || '-'}</td>
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
                        <div className={`text-xs ${muted}`}>{formatKESMajor(costPrice * stock.quantity)} total</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="font-semibold">{formatKESMajor(sellPrice)}</div>
                        <div className={`text-xs ${muted}`}>{formatKESMajor(sellPrice * stock.quantity)} total</div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button type="button" size="sm" variant="ghost" title="View" onClick={() => openViewModal(stock)}><Eye className="h-4 w-4" /></Button>
                          <Button size="sm" variant="outline" title="Restock" onClick={() => { setRestockStockId(stock.id); setIsRestockModalOpen(true); setRestockQuantity(stock.quantity); }}>Restock</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredStocks.length === 0 && (
              <div className={`text-center py-8 ${muted}`}>{stocks.length === 0 ? 'No stock items found' : 'No matching items'}</div>
            )}
          </div>
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
    </div>
  );
}

export default function StockManagementPage() {
  return <StockManagementContent />;
}
