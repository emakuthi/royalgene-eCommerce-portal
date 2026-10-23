'use client';

import { useCallback, useEffect, useState } from 'react';
import { useBranding } from './branding-context';
import { PRODUCT_UNITS } from './business-types';

export interface ProductCategoryOption {
  id: string;
  slug: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

/**
 * The workspace's product categories (from /api/portal/business) plus its
 * option names (already on the branding context). Category lists are small,
 * so every page that needs them just fetches.
 */
export function useBusinessSettings(token: string | null | undefined) {
  const { branding } = useBranding();
  const [categories, setCategories] = useState<ProductCategoryOption[]>([]);
  const [units, setUnits] = useState<readonly string[]>(PRODUCT_UNITS);
  const [requireAppLock, setRequireAppLock] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/api/portal/business', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const json = await res.json();
      if (json?.success && json.data) {
        setCategories(Array.isArray(json.data.categories) ? json.data.categories : []);
        if (Array.isArray(json.data.units) && json.data.units.length) setUnits(json.data.units);
        setRequireAppLock(json.data.requireAppLock === true);
      }
    } catch {
      /* keep what we have */
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => { void reload(); }, [reload]);

  const categoryName = useCallback(
    (slug: string | null | undefined) => {
      if (!slug) return '';
      return categories.find((c) => c.slug === slug)?.name ?? slug.replace(/-/g, ' ');
    },
    [categories],
  );

  return {
    businessType: branding.businessType,
    option1Label: branding.option1Label,
    option2Label: branding.option2Label,
    categories,
    activeCategories: categories.filter((c) => c.isActive),
    units,
    requireAppLock,
    categoryName,
    loaded,
    reload,
  };
}
