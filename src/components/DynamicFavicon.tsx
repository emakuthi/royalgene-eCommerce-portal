'use client';

import { useEffect } from 'react';
import { DEFAULT_FAVICON_LINKS } from '@/lib/branding';
import { useBranding } from '@/lib/branding-context';

/**
 * Keeps the <link rel="icon"> tags in sync with the tenant's branding.
 * generateMetadata() already renders the right icon server-side; this handles
 * client-side branding changes (Settings → Branding) without a full reload.
 * Renders nothing.
 */
export default function DynamicFavicon() {
  const { branding } = useBranding();
  const favicon = branding.faviconUrl;

  useEffect(() => {
    const head = document.head;
    head.querySelectorAll('link[rel~="icon"], link[data-dynamic-favicon]').forEach((el) => el.remove());

    const hrefs = favicon ? [favicon] : DEFAULT_FAVICON_LINKS;
    for (const href of hrefs) {
      const link = document.createElement('link');
      link.rel = 'icon';
      link.href = href;
      link.dataset.dynamicFavicon = 'true';
      head.appendChild(link);
    }
  }, [favicon]);

  return null;
}
