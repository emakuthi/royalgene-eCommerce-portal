'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { toast } from 'sonner';
import {
  X,
  Package,
  DollarSign,
  Ruler,
  ImageIcon,
  Store,
  ArrowLeft,
  Sparkles,
  RotateCcw,
  Plus,
  Info,
} from 'lucide-react';
import PortalHeader from '@/components/portal/PortalHeader';
import { ImageUpload } from '@/components/image-upload';
import type { Shop } from '@/lib/types';

/* ------------------------------------------------------------------ */
/*  Form shape                                                        */
/* ------------------------------------------------------------------ */
type AddForm = {
  name: string;
  category: string;
  brand: string;
  sku: string;
  description: string;
  costPrice: string;
  sellingPrice: string;
  minLevel: string;
  initialQuantity: string | number;
  images: string[];
  sizesArray: string[];
  colorsArray: string[];
  shopId: string;
};

const EMPTY_FORM: AddForm = {
  name: '',
  category: 'dresses',
  brand: '',
  sku: '',
  description: '',
  costPrice: '',
  sellingPrice: '',
  minLevel: '',
  initialQuantity: '',
  images: [],
  sizesArray: [],
  colorsArray: [],
  shopId: '',
};

const CATEGORIES = [
  { value: 'dresses', label: 'Dresses' },
  { value: 'shoes', label: 'Shoes' },
  { value: 'trousers', label: 'Trousers' },
  { value: 'textiles', label: 'Textiles' },
] as const;

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function AddNewProductPage() {
  const { token, user: authUser } = useHydratedAuth();
  const { currentShop, setCurrentShop } = usePortalStore();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [addProductError, setAddProductError] = useState<string | null>(null);
  const [availableShops, setAvailableShops] = useState<Shop[]>([]);

  const [addForm, setAddForm] = useState<AddForm>({
    ...EMPTY_FORM,
    shopId: currentShop?.id || '',
  });
  const [sizeInput, setSizeInput] = useState('');
  const [colorInput, setColorInput] = useState('');

  /* ---- lifecycle ---- */
  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted || !token) return;
    (async () => {
      try {
        const response = await fetch('/api/portal/shops', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.success) return;
        const shops: Shop[] = Array.isArray(data.data) ? data.data : [];
        setAvailableShops(shops);
        if (!addForm.shopId && shops.length > 0) {
          const defaultShopId = currentShop?.id ?? shops[0].id;
          setAddForm(prev => ({ ...prev, shopId: defaultShopId }));
        }
        if (!currentShop && shops.length > 0) {
          setCurrentShop(shops[0]);
        }
      } catch (err) {
        console.error('Failed to fetch shops:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, token]);

  /* ---- helpers ---- */
  const handleChange = useCallback(
    (key: keyof AddForm, value: string) => {
      setAddForm(prev => ({ ...prev, [key]: value }));
      if (key === 'shopId') {
        const shopObj = availableShops.find(s => s.id === value);
        if (shopObj) setCurrentShop(shopObj);
      }
    },
    [availableShops, setCurrentShop],
  );

  const handleImageUploaded = (url: string) =>
    setAddForm(prev => ({ ...prev, images: [...prev.images, url] }));
  const handleImageRemove = (url: string) =>
    setAddForm(prev => ({ ...prev, images: prev.images.filter(u => u !== url) }));

  const addSize = () => {
    const v = sizeInput.trim();
    if (!v) return;
    setAddForm(prev => ({
      ...prev,
      sizesArray: Array.from(new Set([...prev.sizesArray, v])),
    }));
    setSizeInput('');
  };
  const removeSize = (s: string) =>
    setAddForm(prev => ({ ...prev, sizesArray: prev.sizesArray.filter(x => x !== s) }));

  const addColor = () => {
    const v = colorInput.trim();
    if (!v) return;
    setAddForm(prev => ({
      ...prev,
      colorsArray: Array.from(new Set([...prev.colorsArray, v])),
    }));
    setColorInput('');
  };
  const removeColor = (c: string) =>
    setAddForm(prev => ({ ...prev, colorsArray: prev.colorsArray.filter(x => x !== c) }));

  const clearForm = () => {
    setAddForm({ ...EMPTY_FORM, shopId: currentShop?.id || '' });
    setSizeInput('');
    setColorInput('');
    setAddProductError(null);
  };

  /* ---- submit ---- */
  const handleAddProduct = async () => {
    if (!addForm.name || !addForm.sku) {
      toast.error('Please provide product name and SKU');
      return;
    }
    if (!addForm.shopId) {
      toast.error('Please select a shop');
      return;
    }

    setCreatingProduct(true);
    setAddProductError(null);

    try {
      const initialQty = Number(addForm.initialQuantity ?? '') || 0;
      const sellingPriceFinal = Number(addForm.sellingPrice) || 0;
      const costPriceFinal = Number(addForm.costPrice) || 0;

      const payload = {
        product: {
          name: addForm.name,
          description: addForm.description,
          price: sellingPriceFinal,
          costPrice: costPriceFinal,
          category: addForm.category,
          images: addForm.images,
          sizes: addForm.sizesArray,
          colors: addForm.colorsArray,
          sku: addForm.sku,
          featured: false,
          trending: false,
          stockQuantity: initialQty,
        },
        stock: {
          quantity: initialQty,
          lowStockThreshold: Number(addForm.minLevel) || 0,
        },
        shopId: addForm.shopId,
      };

      const res = await fetch('/api/portal/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        setAddProductError(json.error || 'Failed to create product');
        toast.error(json.error || 'Failed to create product');
        return;
      }

      if (json.warning) toast(json.warning);
      toast.success('Product created successfully!');
      router.push('/stock');
    } catch (err) {
      console.error('Add product error', err);
      setAddProductError('Failed to create product');
      toast.error('Failed to create product');
    } finally {
      setCreatingProduct(false);
    }
  };

  /* ---- margin of profit preview ---- */
  const costNum = Number(addForm.costPrice) || 0;
  const sellNum = Number(addForm.sellingPrice) || 0;
  const margin = sellNum > 0 && costNum > 0 ? (((sellNum - costNum) / sellNum) * 100).toFixed(1) : null;

  /* ---- loading states ---- */
  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (authUser?.role === 'portal_user' && !currentShop && !addForm.shopId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">Loading shop information...</p>
      </div>
    );
  }

  /* ---- render ---- */
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <PortalHeader
        backHref="/stock"
        title="Add New Product"
        description="Create a new product and add it to your shop inventory"
        breadcrumbs={[
          { label: 'Portal', href: '/portal' },
          { label: 'Stock', href: '/stock' },
          { label: 'Add New' },
        ]}
      />

      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 pb-28 lg:pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ============================================ */}
          {/*  MAIN FORM                                   */}
          {/* ============================================ */}
          <div className="lg:col-span-2 space-y-6">
            {/* ---- Shop Selection ---- */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Store className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  <CardTitle>Shop / Outlet</CardTitle>
                </div>
                <CardDescription>Select which shop this product will be added to</CardDescription>
              </CardHeader>
              <CardContent>
                <select
                  aria-label="Select shop"
                  className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={addForm.shopId}
                  onChange={e => handleChange('shopId', e.target.value)}
                >
                  <option value="" disabled>
                    Select a shop
                  </option>
                  {availableShops.map(shop => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name} — {shop.location}
                    </option>
                  ))}
                </select>
              </CardContent>
            </Card>

            {/* ---- Basic Information ---- */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Package className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                  <CardTitle>Basic Information</CardTitle>
                </div>
                <CardDescription>Product name, category, SKU and description</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Product Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="product-name">
                    Product Name <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="product-name"
                    value={addForm.name}
                    onChange={e => handleChange('name', e.target.value)}
                    placeholder="e.g. Elegant Maxi Dress"
                  />
                </div>

                {/* Category + Brand */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="category">
                      Category <span className="text-red-500">*</span>
                    </Label>
                    <select
                      id="category"
                      aria-label="Select category"
                      className="block w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-950 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                      value={addForm.category}
                      onChange={e => handleChange('category', e.target.value)}
                    >
                      <option value="" disabled>
                        Select category
                      </option>
                      {CATEGORIES.map(c => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="brand">Brand</Label>
                    <Input
                      id="brand"
                      value={addForm.brand}
                      onChange={e => handleChange('brand', e.target.value)}
                      placeholder="e.g. Royal Gene"
                    />
                  </div>
                </div>

                {/* SKU */}
                <div className="space-y-1.5">
                  <Label htmlFor="sku">
                    SKU (Stock Keeping Unit) <span className="text-red-500">*</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="sku"
                      value={addForm.sku}
                      onChange={e => handleChange('sku', e.target.value)}
                      placeholder="e.g. DRE-6095"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleChange('sku', `SKU-${Date.now()}`)}
                      className="shrink-0 gap-1.5"
                    >
                      <Sparkles className="h-4 w-4" />
                      Generate
                    </Button>
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={addForm.description}
                    onChange={e => handleChange('description', e.target.value)}
                    placeholder="Briefly describe this product..."
                    minRows={3}
                    maxRows={6}
                  />
                </div>
              </CardContent>
            </Card>

            {/* ---- Pricing & Stock ---- */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-600 dark:text-green-400" />
                  <CardTitle>Pricing &amp; Stock</CardTitle>
                </div>
                <CardDescription>Set cost price, selling price and initial stock levels</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="cost-price">
                      Cost Price (KES) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="cost-price"
                      type="number"
                      value={addForm.costPrice}
                      onChange={e => handleChange('costPrice', e.target.value)}
                      placeholder="e.g. 1000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="selling-price">
                      Selling Price (KES) <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="selling-price"
                      type="number"
                      value={addForm.sellingPrice}
                      onChange={e => handleChange('sellingPrice', e.target.value)}
                      placeholder="e.g. 1500"
                    />
                  </div>
                </div>

                {/* Margin indicator */}
                {margin !== null && (
                  <div className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800">
                    <Info className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                    <span className="text-green-700 dark:text-green-300">
                      Profit margin: <strong>{margin}%</strong> (KES {(sellNum - costNum).toLocaleString()} per unit)
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="initial-quantity">Initial Stock Quantity</Label>
                    <Input
                      id="initial-quantity"
                      type="number"
                      value={addForm.initialQuantity}
                      onChange={e => handleChange('initialQuantity', e.target.value)}
                      placeholder="e.g. 50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="min-level">
                      Minimum Stock Level <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="min-level"
                      type="number"
                      value={addForm.minLevel}
                      onChange={e => handleChange('minLevel', e.target.value)}
                      placeholder="e.g. 10"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      You&apos;ll be alerted when stock drops below this level
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ---- Variants (Sizes + Colors) ---- */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Ruler className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  <CardTitle>Variants</CardTitle>
                </div>
                <CardDescription>Add available sizes and colors for this product</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Sizes */}
                <div className="space-y-2">
                  <Label>Sizes</Label>
                  <div className="flex gap-2">
                    <Input
                      value={sizeInput}
                      onChange={e => setSizeInput(e.target.value)}
                      placeholder="e.g. S, M, L, XL"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSize(); } }}
                    />
                    <Button type="button" variant="outline" onClick={addSize} className="shrink-0 gap-1.5">
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                  {addForm.sizesArray.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {addForm.sizesArray.map(s => (
                        <Badge key={s} className="gap-1 pl-3 pr-1 py-1 text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                          {s}
                          <button
                            aria-label={`Remove size ${s}`}
                            type="button"
                            onClick={() => removeSize(s)}
                            className="ml-0.5 p-0.5 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                {/* Colors */}
                <div className="space-y-2">
                  <Label>Colors</Label>
                  <div className="flex gap-2">
                    <Input
                      value={colorInput}
                      onChange={e => setColorInput(e.target.value)}
                      placeholder="e.g. Red, Blue, Green"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addColor(); } }}
                    />
                    <Button type="button" variant="outline" onClick={addColor} className="shrink-0 gap-1.5">
                      <Plus className="h-4 w-4" />
                      Add
                    </Button>
                  </div>
                  {addForm.colorsArray.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {addForm.colorsArray.map(c => (
                        <Badge key={c} className="gap-1 pl-3 pr-1 py-1 text-sm bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-200">
                          {c}
                          <button
                            aria-label={`Remove color ${c}`}
                            type="button"
                            onClick={() => removeColor(c)}
                            className="ml-0.5 p-0.5 rounded-full hover:bg-pink-200 dark:hover:bg-pink-800 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* ---- Images ---- */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  <CardTitle>Product Images</CardTitle>
                </div>
                <CardDescription>Upload up to 5 product photos</CardDescription>
              </CardHeader>
              <CardContent>
                <ImageUpload
                  images={addForm.images}
                  onImageUpload={handleImageUploaded}
                  onRemove={handleImageRemove}
                />
              </CardContent>
            </Card>

            {/* Error banner */}
            {addProductError && (
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-red-600 dark:text-red-400 text-sm flex items-start gap-3">
                <Info className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">Something went wrong</p>
                  <p className="mt-0.5">{addProductError}</p>
                </div>
              </div>
            )}
          </div>

          {/* ============================================ */}
          {/*  SIDEBAR (desktop)                           */}
          {/* ============================================ */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-5">
              {/* Actions */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Actions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    onClick={handleAddProduct}
                    className="w-full gap-2"
                    disabled={creatingProduct}
                  >
                    {creatingProduct ? (
                      <>
                        <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Adding…
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        Add Product
                      </>
                    )}
                  </Button>
                  <Button variant="outline" onClick={clearForm} className="w-full gap-2">
                    <RotateCcw className="h-4 w-4" />
                    Clear Form
                  </Button>
                  <Link href="/stock" className="block">
                    <Button variant="ghost" className="w-full gap-2">
                      <ArrowLeft className="h-4 w-4" />
                      Back to Stock
                    </Button>
                  </Link>
                </CardContent>
              </Card>

              {/* Quick Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Quick Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="space-y-2 text-sm text-gray-600 dark:text-gray-300">
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Name</dt>
                      <dd className="font-medium truncate max-w-[150px]">{addForm.name || '—'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">SKU</dt>
                      <dd className="font-mono text-xs">{addForm.sku || '—'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Category</dt>
                      <dd className="capitalize">{addForm.category || '—'}</dd>
                    </div>

                    <hr className="border-gray-200 dark:border-gray-700" />

                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Cost</dt>
                      <dd>{costNum ? `KES ${costNum.toLocaleString()}` : '—'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Price</dt>
                      <dd>{sellNum ? `KES ${sellNum.toLocaleString()}` : '—'}</dd>
                    </div>
                    {margin !== null && (
                      <div className="flex justify-between">
                        <dt className="text-gray-500 dark:text-gray-400">Margin</dt>
                        <dd className="text-green-600 dark:text-green-400 font-medium">{margin}%</dd>
                      </div>
                    )}

                    <hr className="border-gray-200 dark:border-gray-700" />

                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Images</dt>
                      <dd>{addForm.images.length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Sizes</dt>
                      <dd>{addForm.sizesArray.length}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-gray-500 dark:text-gray-400">Colors</dt>
                      <dd>{addForm.colorsArray.length}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </aside>
        </div>
      </div>

      {/* ============================================ */}
      {/*  MOBILE BOTTOM BAR                           */}
      {/* ============================================ */}
      <div className="fixed inset-x-0 bottom-0 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-t border-gray-200 dark:border-gray-700 p-3 shadow-lg lg:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={clearForm} className="gap-1.5">
            <RotateCcw className="h-4 w-4" />
            Clear
          </Button>
          <Button
            size="sm"
            onClick={handleAddProduct}
            disabled={creatingProduct}
            className="gap-1.5"
          >
            {creatingProduct ? (
              <>
                <div className="h-3.5 w-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Adding…
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                Add Product
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
