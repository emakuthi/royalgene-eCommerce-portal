'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Briefcase, Eye, EyeOff, Loader2, Pencil, Plus, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBranding } from '@/lib/branding-context';
import { BUSINESS_TYPES, MAX_CATEGORY_NAME_LENGTH, MAX_OPTION_LABEL_LENGTH, getBusinessType } from '@/lib/business-types';
import { useBusinessSettings, type ProductCategoryOption } from '@/lib/use-business-settings';

const card = 'bg-white dark:bg-gray-900 rounded-2xl border border-[hsl(var(--border))] overflow-hidden';
const field = 'w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm';

async function call(token: string | null | undefined, url: string, method: string, body: unknown) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok && json?.success !== false, data: json?.data, error: json?.error as string | undefined };
  } catch {
    return { ok: false, data: undefined, error: 'Network error' };
  }
}

/**
 * Settings -> Business. What kind of business this workspace is, what its two
 * product options are called, and its product categories. Owner-editable;
 * everyone else sees it read-only.
 */
export default function BusinessTab({ token, canEdit }: { token: string | null | undefined; canEdit: boolean }) {
  const { refresh: refreshBranding } = useBranding();
  const business = useBusinessSettings(token);
  const [type, setType] = useState(business.businessType);
  const [o1, setO1] = useState(business.option1Label);
  const [o2, setO2] = useState(business.option2Label);
  const [saving, setSaving] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [busyCategory, setBusyCategory] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    setType(business.businessType);
    setO1(business.option1Label);
    setO2(business.option2Label);
  }, [business.businessType, business.option1Label, business.option2Label]);

  const typeChanged = type !== business.businessType;
  const labelsChanged = o1 !== business.option1Label || o2 !== business.option2Label;

  function pickType(id: string) {
    setType(id);
    const def = getBusinessType(id);
    setO1(def.option1Label);
    setO2(def.option2Label);
  }

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = { option1Label: o1.trim(), option2Label: o2.trim() };
    if (typeChanged) body.businessType = type;
    const res = await call(token, '/api/portal/business', 'PUT', body);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || 'Could not save');
      return;
    }
    toast.success(typeChanged ? `Set up as ${getBusinessType(type).label}` : 'Saved');
    await Promise.all([refreshBranding(), business.reload()]);
  }

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

  if (!business.loaded) {
    return (
      <div className={`${card} p-10 flex items-center justify-center text-gray-400`}>
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className={card}>
        <div className="px-6 py-5 border-b border-[hsl(var(--border))] flex items-start gap-3">
          <Briefcase className="h-5 w-5 text-[hsl(var(--primary))] mt-0.5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Business type</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Sets the wording and starter categories. Changing it adds that type&apos;s categories; your products and existing categories stay as they are.
            </p>
          </div>
        </div>
        <fieldset disabled={!canEdit || saving} className="p-6 space-y-5 disabled:opacity-70">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {BUSINESS_TYPES.map((t) => {
              const active = t.id === type;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickType(t.id)}
                  aria-pressed={active}
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    active
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))]/5 ring-1 ring-[hsl(var(--primary))]'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900 dark:text-white">{t.label}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</div>
                </button>
              );
            })}
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">Product options</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
              What your products vary by, e.g. Size and Colour, or Strength and Pack size. Leave a name empty to switch that option off.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs text-gray-500 mb-1">First option</span>
                <input className={field} value={o1} maxLength={MAX_OPTION_LABEL_LENGTH} placeholder="Off" onChange={(e) => setO1(e.target.value)} />
              </label>
              <label className="block">
                <span className="block text-xs text-gray-500 mb-1">Second option</span>
                <input className={field} value={o2} maxLength={MAX_OPTION_LABEL_LENGTH} placeholder="Off" onChange={(e) => setO2(e.target.value)} />
              </label>
            </div>
          </div>

          {canEdit ? (
            <Button type="button" onClick={save} disabled={saving || (!typeChanged && !labelsChanged)}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          ) : (
            <p className="text-sm text-gray-500">Only the workspace owner can change these.</p>
          )}
        </fieldset>
      </div>

      <div className={card}>
        <div className="px-6 py-5 border-b border-[hsl(var(--border))] flex items-start gap-3">
          <Tags className="h-5 w-5 text-[hsl(var(--primary))] mt-0.5 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Product categories</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Hidden categories disappear from the pickers but products already in them keep it.
            </p>
          </div>
        </div>
        <div className="p-6 space-y-4">
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
                      <Button type="button" variant="ghost" size="sm" aria-label={`Rename ${c.name}`} disabled={busyCategory === c.id}
                        onClick={() => setRenaming({ id: c.id, name: c.name })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" aria-label={c.isActive ? `Hide ${c.name}` : `Show ${c.name}`} disabled={busyCategory === c.id}
                        onClick={() => patchCategory(c, { isActive: !c.isActive })}>
                        {c.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
