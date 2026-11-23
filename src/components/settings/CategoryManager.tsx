'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MAX_CATEGORY_NAME_LENGTH } from '@/lib/business-types';
import type { ProductCategoryOption, useBusinessSettings } from '@/lib/use-business-settings';

const field = 'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm';

async function call(token: string | null | undefined, url: string, method: string, body?: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json?.success !== false, status: res.status, code: json?.code as string | undefined, data: json?.data, error: json?.error as string | undefined };
  } catch {
    return { ok: false, status: 0, code: undefined, data: undefined, error: 'Network error' };
  }
}

/**
 * The workspace's product categories: add, rename, hide and delete. Used in
 * Settings -> Business and from the product forms' "Edit categories". Owners
 * edit; everyone else just sees the list.
 */
export default function CategoryManager({
  token,
  canEdit,
  business,
}: {
  token: string | null | undefined;
  canEdit: boolean;
  business: ReturnType<typeof useBusinessSettings>;
}) {
  const [newCategory, setNewCategory] = useState('');
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setBusyCategory('new');
    const res = await call(token, '/api/portal/product-categories', 'POST', { name });
    setBusyCategory(null);
    if (!res.ok) {
      toast.error(res.error || 'Could not add category');
      return;
    }
    setNewCategory('');
    await business.reload();
  }

  async function patchCategory(c: ProductCategoryOption, patch: Record<string, unknown>) {
    setBusyCategory(c.id);
    const res = await call(token, `/api/portal/product-categories/${c.id}`, 'PATCH', patch);
    setBusyCategory(null);
    if (!res.ok) {
      toast.error(res.error || 'Could not update category');
      return false;
    }
    await business.reload();
    return true;
  }

  async function deleteCategory(c: ProductCategoryOption) {
    if (!window.confirm(`Delete "${c.name}"? This can't be undone.`)) return;
    setBusyCategory(c.id);
    let res = await call(token, `/api/portal/product-categories/${c.id}`, 'DELETE');
    if (res.code === 'CATEGORY_IN_USE') {
      // Products are still in it: say how many move to Other, then go ahead only on a yes.
      if (!window.confirm(res.error || `Products in "${c.name}" will move to Other. Continue?`)) {
        setBusyCategory(null);
        return;
      }
      res = await call(token, `/api/portal/product-categories/${c.id}?moveProducts=1`, 'DELETE');
    }
    setBusyCategory(null);
    if (!res.ok) {
      toast.error(res.error || 'Could not delete category');
      return;
    }
    const moved = Number(res.data?.movedProducts) || 0;
    toast.success(moved ? `Deleted "${c.name}"; ${moved} product${moved === 1 ? '' : 's'} moved to Other` : `Deleted "${c.name}"`);
    await business.reload();
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex gap-2">
          <input
            className={field}
            value={newCategory}
            maxLength={MAX_CATEGORY_NAME_LENGTH}
            placeholder="New category"
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory(); } }}
          />
          <Button type="button" variant="outline" onClick={addCategory} disabled={busyCategory === 'new' || !newCategory.trim()} className="gap-1.5 shrink-0">
            <Plus className="h-4 w-4" />Add
          </Button>
        </div>
      )}
      {business.categories.length === 0 ? (
        <p className="text-sm text-gray-500">No categories yet.</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))]">
          {business.categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-2.5">
              {renaming?.id === c.id ? (
                <input
                  autoFocus
                  className={field}
                  value={renaming.name}
                  maxLength={MAX_CATEGORY_NAME_LENGTH}
                  onChange={(e) => setRenaming({ id: c.id, name: e.target.value })}
                  onKeyDown={async (e) => {
                    if (e.key === 'Escape') setRenaming(null);
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (await patchCategory(c, { name: renaming.name })) setRenaming(null);
                    }
                  }}
                  onBlur={async () => {
                    if (renaming.name.trim() && renaming.name.trim() !== c.name) await patchCategory(c, { name: renaming.name });
                    setRenaming(null);
                  }}
                />
              ) : (
                <span className={`flex-1 text-sm ${c.isActive ? 'text-gray-900 dark:text-white' : 'text-gray-400 line-through'}`}>{c.name}</span>
              )}
              {canEdit && renaming?.id !== c.id && (
                <div className="flex gap-1 shrink-0">
                  <Button type="button" variant="ghost" size="sm" aria-label={`Rename ${c.name}`} title="Rename" disabled={busyCategory === c.id}
                    onClick={() => setRenaming({ id: c.id, name: c.name })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={c.isActive ? `Hide ${c.name}` : `Show ${c.name}`} title={c.isActive ? 'Hide' : 'Show'} disabled={busyCategory === c.id}
                    onClick={() => patchCategory(c, { isActive: !c.isActive })}>
                    {c.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  {c.slug !== 'other' && (
                    <Button type="button" variant="ghost" size="sm" aria-label={`Delete ${c.name}`} title="Delete" disabled={busyCategory === c.id}
                      onClick={() => deleteCategory(c)} className="text-red-600 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "Edit categories" for a product form: the same manager in a dialog, for owners. */
export function EditCategoriesButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline">
      <Pencil className="h-3 w-3" />Edit categories
    </button>
  );
}

/** The manager in a dialog, opened from a product form. */
export function CategoriesDialog({
  open,
  onClose,
  token,
  business,
}: {
  open: boolean;
  onClose: () => void;
  token: string | null | undefined;
  business: ReturnType<typeof useBusinessSettings>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} fullWidth maxWidth="sm">
      <DialogContent>
        <DialogHeader>
          <DialogTitle sx={{ px: 0 }}>Product categories</DialogTitle>
          <p className="text-sm text-gray-500">Rename, hide or delete. Deleting one moves its products to Other.</p>
        </DialogHeader>
        <div className="mt-4">
          <CategoryManager token={token} canEdit business={business} />
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
