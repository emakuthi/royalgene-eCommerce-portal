'use client';

import { useEffect } from 'react';
import { BRANDING_EVENT, DEFAULT_FAVICON_LINKS, loadBranding, type BrandingConfig } from '@/lib/branding';

/**
 * Applies a custom favicon (Settings → Appearance → Branding) by rewriting the
 * <link rel="icon"> tags at runtime. Like the logo, the value lives in this
 * browser's localStorage — no server round-trip, no effect on other viewers.
 * Renders nothing.
 */
export default function DynamicFavicon() {
  useEffect(() => {
    const apply = (b: BrandingConfig) => {
      const head = document.head;
      // Drop any icon links we (or Next's metadata) previously set.
      head.querySelectorAll('link[rel~="icon"], link[data-dynamic-favicon]').forEach((el) => el.remove());

      const hrefs = b.faviconSrc ? [b.faviconSrc] : DEFAULT_FAVICON_LINKS;
      for (const href of hrefs) {
        const link = document.createElement('link');
        link.rel = 'icon';
        link.href = href;
        link.dataset.dynamicFavicon = 'true';
        head.appendChild(link);
      }
    };

    apply(loadBranding());

    const onChange = (e: Event) => apply((e as CustomEvent<BrandingConfig>).detail ?? loadBranding());
    window.addEventListener(BRANDING_EVENT, onChange);
    return () => window.removeEventListener(BRANDING_EVENT, onChange);
  }, []);

  return null;
}
