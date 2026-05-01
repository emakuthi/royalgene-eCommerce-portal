'use client';

import React, { useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { useAuthStore } from '@/lib/store';
import { Plus as PlusIcon, ImagePlus } from 'lucide-react';

// Material UI imports
import Paper from '@mui/material/Paper';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import MUIButton from '@mui/material/Button';
import CloseIcon from '@mui/icons-material/Close';
import { toast } from 'sonner';
import type { Product } from '@/lib/types';

type Category = Product['category'];

interface Props {
  editingProduct?: Product | null;
  onSaved?: () => void;
  onCancel?: () => void;
}

interface FormState {
  name: string;
  description: string;
  price: number;
  category: Category;
  images: string[];
  sizes: string[];
  colors: string[];
  stockQuantity: number;
  sku: string;
  featured: boolean;
  trending: boolean;
}

const CATEGORY_CODE: Record<Category, string> = {
  dresses: 'DRS',
  shoes: 'SHO',
  trousers: 'TRS',
  textiles: 'TXT',
};

function generateSkuFromName(name: string, category?: Category) {
  const prefix = category ? CATEGORY_CODE[category] : 'PRD';
  const base = (name || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  const short = base.slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${short ? '-' + short : ''}-${suffix}`;
}

export const ProductForm: React.FC<Props> = ({ editingProduct = null, onSaved, onCancel }) => {
  const { token } = useAuthStore();

  // local inputs
  const [sizeInput, setSizeInput] = useState('');
  const [colorInput, setColorInput] = useState('');

  const [formData, setFormData] = useState<FormState>({
    name: '',
    description: '',
    price: 0,
    category: 'dresses',
    images: [''],
    sizes: [],
    colors: [],
    stockQuantity: 0,
    sku: '',
    featured: false,
    trending: false,
  });

  const [skuManuallyEdited, setSkuManuallyEdited] = useState(false);
  const [skuExists, setSkuExists] = useState<boolean | null>(null);
  const skuCheckTimeout = useRef<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return () => {
      if (skuCheckTimeout.current) window.clearTimeout(skuCheckTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (editingProduct) {
      setFormData({
        name: editingProduct.name,
        description: editingProduct.description,
        price: editingProduct.price,
        category: editingProduct.category,
        images: editingProduct.images && editingProduct.images.length > 0 ? editingProduct.images : [''],
        sizes: editingProduct.sizes ?? [],
        colors: editingProduct.colors ?? [],
        stockQuantity: editingProduct.stockQuantity,
        sku: editingProduct.sku,
        featured: !!editingProduct.featured,
        trending: !!editingProduct.trending,
      });
      setSkuManuallyEdited(!!editingProduct.sku);
    }
  }, [editingProduct]);

  // image handling — supports multiple files at once
  const multiFileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Resize + compress an image file to a max dimension of 800 px and JPEG quality 0.75.
   * This keeps base64 payloads well under 100 KB each so the API body limit is never hit.
   */
  function compressImage(file: File, maxDim = 800, quality = 0.75): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (ev) => {
        const img = new window.Image();
        img.onerror = reject;
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
            else                { width = Math.round((width * maxDim) / height); height = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('canvas context unavailable')); return; }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = ev.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleMultiImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    try {
      const base64s = await Promise.all(files.map((f) => compressImage(f)));
      setFormData((prev) => {
        // Remove any empty placeholder slots, then append new images
        const existing = prev.images.filter(Boolean);
        return { ...prev, images: [...existing, ...base64s] };
      });
      toast.success(`${files.length} image${files.length > 1 ? 's' : ''} uploaded`);
    } catch {
      toast.error('Failed to read one or more images');
    }
    // Reset input so the same files can be re-selected if needed
    e.target.value = '';
  }

  function handleUrlChange(index: number, value: string) {
    const newImgs = [...formData.images];
    newImgs[index] = value;
    // Keep at least one slot
    setFormData((prev) => ({ ...prev, images: newImgs }));
  }

  function removeImage(index: number) {
    const newImgs = formData.images.filter((_, i) => i !== index);
    setFormData((prev) => ({ ...prev, images: newImgs.length ? newImgs : [''] }));
  }
  function addImageSlot() {
    setFormData((prev) => ({ ...prev, images: [...prev.images, ''] }));
  }

  // sizes/colors
  function addSize() {
    const v = (sizeInput || '').trim();
    if (!v) return;
    if (formData.sizes.includes(v)) {
      setSizeInput('');
      return;
    }
    setFormData((prev) => ({ ...prev, sizes: [...prev.sizes, v] }));
    setSizeInput('');
  }
  function removeSize(idx: number) {
    setFormData((prev) => ({ ...prev, sizes: prev.sizes.filter((_, i) => i !== idx) }));
  }
  function addColor() {
    const v = (colorInput || '').trim();
    if (!v) return;
    if (formData.colors.includes(v)) {
      setColorInput('');
      return;
    }
    setFormData((prev) => ({ ...prev, colors: [...prev.colors, v] }));
    setColorInput('');
  }
  function removeColor(idx: number) {
    setFormData((prev) => ({ ...prev, colors: prev.colors.filter((_, i) => i !== idx) }));
  }

  async function checkSkuAvailability(sku: string) {
    try {
      const idParam = editingProduct?.id ? `&id=${encodeURIComponent(editingProduct.id)}` : '';
      const res = await fetch(`/api/admin/products/check-sku?sku=${encodeURIComponent(sku)}${idParam}`);
      const json = await res.json();
      if (json && json.success) setSkuExists(Boolean(json.exists));
    } catch (err) {
      console.warn('SKU check failed', err);
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (skuExists) {
      toast.error('SKU already exists. Please choose a different SKU.');
      return;
    }
    setSubmitting(true);
    try {
      const url = '/api/admin/products';
      const method = editingProduct ? 'PUT' : 'POST';
      const payload = editingProduct ? { id: editingProduct.id, ...formData } : formData;
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editingProduct ? 'Product updated!' : 'Product created!');
        onSaved?.();
      } else {
        toast.error(data.error || 'Operation failed');
      }
    } catch (err) {
      console.error('Error saving product:', err);
      toast.error('An error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 1400, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
      {/* Backdrop */}
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }} />

      <Paper elevation={24} sx={{ position: 'relative', width: 'min(95vw,720px)', maxHeight: '80vh', overflow: 'hidden', borderRadius: 3 }}>
        {/* Header */}
        <Box sx={{ position: 'sticky', top: 0, zIndex: 20, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1 }}>
            <Box>
              <Typography variant="h6" noWrap>{editingProduct ? 'Edit Product' : 'Add New Product'}</Typography>
              <Typography variant="caption" color="text.secondary">
                {editingProduct ? `Editing: ${editingProduct.name}` : 'Start by uploading images, then fill in the details'}
              </Typography>
            </Box>
            <IconButton aria-label="close" onClick={() => onCancel?.()}><CloseIcon /></IconButton>
          </Box>
        </Box>

        {/* Content */}
        <Box sx={{ p: 1, maxHeight: 'calc(80vh - 6rem)', overflow: 'auto' }}>
          <Box sx={{ width: '100%', mx: 'auto' }}>
            <form onSubmit={handleSubmit}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr' }, gap: 1 }}>

                {/* ── 1. Product Images (first) ── */}
                <Box sx={{ mt: 1 }}>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>📷 Product Images</Typography>

                  {/* Upload button */}
                  <label htmlFor="product-multi-image-upload" style={{ display: 'inline-block', marginBottom: 16 }}>
                    <input
                      id="product-multi-image-upload"
                      ref={multiFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}
                      onChange={handleMultiImageUpload}
                    />
                    <MUIButton
                      component="span"
                      variant="outlined"
                      startIcon={<ImagePlus size={16} />}
                      sx={{ borderStyle: 'dashed', pointerEvents: 'none' }}
                    >
                      Choose Images (select multiple)
                    </MUIButton>
                  </label>

                  {/* Image previews grid */}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {formData.images.map((image, index) => (
                      <Box key={index}>
                        <Box sx={{ position: 'relative', width: { xs: 80, sm: 96 }, height: { xs: 80, sm: 96 }, borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
                          {image && (image.startsWith('http') || image.startsWith('data:')) ? (
                            <Image src={image} alt={`Product ${index + 1}`} fill className="object-cover" />
                          ) : (
                            <Box sx={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'text.secondary' }}>No image</Box>
                          )}
                          <IconButton size="small" sx={{ position: 'absolute', top: 2, right: 2, bgcolor: 'error.main', color: 'white', '&:hover': { bgcolor: 'error.dark' } }} onClick={() => removeImage(index)}>
                            <CloseIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                          {index === 0 && (
                            <Box sx={{ position: 'absolute', bottom: 2, left: 2, bgcolor: '#ff4d8b', color: 'white', fontSize: 9, fontWeight: 700, px: 0.75, py: 0.25, borderRadius: 1 }}>MAIN</Box>
                          )}
                        </Box>
                        {/* URL paste input per slot */}
                        <TextField
                          value={image}
                          onChange={(e) => handleUrlChange(index, e.target.value)}
                          placeholder="Paste URL"
                          size="small"
                          sx={{ mt: 0.5, width: { xs: 80, sm: 96 }, '& input': { fontSize: 11, py: 0.5 } }}
                        />
                      </Box>
                    ))}
                    {/* Add blank URL slot */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', pt: 0 }}>
                      <IconButton onClick={addImageSlot} title="Add image URL slot" sx={{ mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
                        <PlusIcon size={18} />
                      </IconButton>
                    </Box>
                  </Box>
                </Box>

                {/* ── 2. Basic Information ── */}
                <TextField
                  id="name"
                  size="small"
                  label="Product Name"
                  required
                  fullWidth
                  value={formData.name}
                  onChange={(e) => {
                    const newName = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      name: newName,
                      sku: !skuManuallyEdited && newName ? generateSkuFromName(newName, prev.category) : prev.sku,
                    }));
                  }}
                  placeholder="Enter product name"
                />

                {/* Category + SKU row */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1 }}>
                  <TextField
                    id="category"
                    select
                    size="small"
                    label="Category"
                    value={formData.category}
                    onChange={(e) => setFormData((p) => ({ ...p, category: e.target.value as Category }))}
                    fullWidth
                    sx={{ '& .MuiInputBase-root': { height: 40 } }}
                  >
                    <MenuItem value="dresses">Dresses</MenuItem>
                    <MenuItem value="shoes">Shoes</MenuItem>
                    <MenuItem value="trousers">Trousers</MenuItem>
                    <MenuItem value="textiles">Textiles</MenuItem>
                  </TextField>

                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField id="sku" size="small" label="SKU" required value={formData.sku} onChange={(e) => {
                      const v = e.target.value;
                      setSkuManuallyEdited(true);
                      setFormData((prev) => ({ ...prev, sku: v }));
                      setSkuExists(null);
                      if (skuCheckTimeout.current) window.clearTimeout(skuCheckTimeout.current);
                      skuCheckTimeout.current = window.setTimeout(() => void checkSkuAvailability(v), 300) as unknown as number;
                    }} sx={{ flex: 1 }} />

                    <MUIButton size="small" variant="contained" sx={{ bgcolor: '#ff4d8b', color: 'white', '&:hover': { bgcolor: '#ff2d6f' } }} onClick={() => {
                      const generated = generateSkuFromName(formData.name || 'PRODUCT', formData.category);
                      setFormData((prev) => ({ ...prev, sku: generated }));
                      setSkuManuallyEdited(true);
                      setSkuExists(null);
                      if (skuCheckTimeout.current) window.clearTimeout(skuCheckTimeout.current);
                      skuCheckTimeout.current = window.setTimeout(() => void checkSkuAvailability(generated), 200) as unknown as number;
                    }}>Generate</MUIButton>
                  </Box>

                  {/* Description below, full width */}
                  <TextField id="description" size="small" label="Description" required multiline rows={3} value={formData.description} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} placeholder="Enter product description" fullWidth sx={{ gridColumn: '1 / -1' }} />
                </Box>

                {/* ── 3. Pricing & Inventory ── */}
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2,1fr)' }, gap: 2 }}>
                    <TextField id="price" size="small" label="Price (KES)" required fullWidth type="number" value={formData.price} onChange={(e) => setFormData((p) => ({ ...p, price: Number(e.target.value) }))} sx={{ '& .MuiInputBase-root': { height: 40 } }} />
                    <TextField id="stock" size="small" label="Stock Quantity" required fullWidth type="number" value={formData.stockQuantity} onChange={(e) => setFormData((p) => ({ ...p, stockQuantity: Number(e.target.value) }))} sx={{ '& .MuiInputBase-root': { height: 40 } }} />
                  </Box>
                </Box>

                {/* ── 4. Sizes & Colors ── */}
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0,1fr))' }, gap: 1 }}>
                    <Box>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) auto' }, gap: 1, alignItems: 'center', mb: 1 }}>
                        <TextField size="small" placeholder="Sizes e.g., S, M, L" value={sizeInput} onChange={(e) => setSizeInput(e.target.value)} sx={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }} />
                        <MUIButton size="small" variant="outlined" onClick={addSize} sx={{ width: { xs: '100%', md: 'auto' } }}>Add</MUIButton>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', rowGap: 6 }}>
                        {formData.sizes.length === 0 ? <Typography variant="caption" color="text.secondary">No sizes added</Typography> : formData.sizes.map((s, i) => (
                          <Chip key={i} label={s} onDelete={() => removeSize(i)} />
                        ))}
                      </Box>
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) auto' }, gap: 1, alignItems: 'center', mb: 1 }}>
                        <TextField size="small" placeholder="Colors e.g., Red, Blue" value={colorInput} onChange={(e) => setColorInput(e.target.value)} sx={{ width: '100%', boxSizing: 'border-box', minWidth: 0 }} />
                        <MUIButton size="small" variant="outlined" onClick={addColor} sx={{ width: { xs: '100%', md: 'auto' } }}>Add</MUIButton>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', rowGap: 6 }}>
                        {formData.colors.length === 0 ? <Typography variant="caption" color="text.secondary">No colors added</Typography> : formData.colors.map((c, i) => (
                          <Chip key={i} label={c} onDelete={() => removeColor(i)} />
                        ))}
                      </Box>
                    </Box>
                  </Box>
                </Box>

              </Box>
            </form>
          </Box>
        </Box>

        {/* Sticky footer */}
        <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', p: 2, display: 'flex', justifyContent: 'flex-end', gap: 2 }}>
          <MUIButton variant="outlined" onClick={() => { setFormData({ name: '', description: '', price: 0, category: 'dresses', images: [''], sizes: [], colors: [], stockQuantity: 0, sku: '', featured: false, trending: false }); setSizeInput(''); setColorInput(''); }} sx={{ borderColor: '#ff4d8b', color: '#ff4d8b' }}>Clear Form</MUIButton>
          <MUIButton variant="contained" onClick={() => { void handleSubmit(); }} disabled={submitting} sx={{ bgcolor: '#ff4d8b', color: 'white', '&:hover': { bgcolor: '#ff2d6f' } }}>{submitting ? 'Saving...' : editingProduct ? 'Update Product' : 'Add Product'}</MUIButton>
        </Box>
      </Paper>
    </Box>
  );
};

export default ProductForm;

