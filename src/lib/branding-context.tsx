'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BRANDING_DEFAULTS, type TenantBranding } from './branding';

interface BrandingContextValue {
  branding: TenantBranding;
  /** Re-fetch from the server (call after a successful PUT). */
  refresh: () => Promise<void>;
  /** Apply a server response optimistically without a round-trip. */
  set: (b: TenantBranding) => void;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: BRANDING_DEFAULTS,
  refresh: async () => {},
  set: () => {},
});

/**
 * Holds the current tenant's branding. Seeded with the value the server
 * rendered (`initial`) so there's no flash, then refreshed on mount to pick
 * up changes made in another tab / by another admin.
 */
export function BrandingProvider({ initial, children }: { initial: TenantBranding; children: React.ReactNode }) {
  const [branding, setBranding] = useState<TenantBranding>(initial);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/branding', { cache: 'no-store' });
      const json = await res.json();
      if (json?.success && json.data) setBranding(json.data as TenantBranding);
    } catch {
      /* keep whatever we have */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <BrandingContext.Provider value={{ branding, refresh, set: setBranding }}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding() {
  return useContext(BrandingContext);
}
