'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import PortalBreadcrumbs, { type Breadcrumb } from './PortalBreadcrumbs';
import { Button } from '@/components/ui/button';

export default function PortalTopBar() {
  const pathname = usePathname() || '/portal';

  // Very small mapping from route to title/description — extend as needed
  const routes: Record<string, { title: string; description?: string }> = {
    '/portal': { title: 'Portal', description: 'Overview' },
    '/portal/dashboard': { title: 'Dashboard', description: 'Admin summary and metrics' },
    '/portal/sales': { title: 'Sales', description: 'Record and review sales' },
    '/portal/sales/new': { title: 'Record Sale', description: 'Enter sale details' },
    '/portal/stock': { title: 'Inventory', description: 'Manage stock levels' },
    '/portal/stock/add-new': { title: 'Add Product', description: 'Create a new product' },
    '/portal/analytics': { title: 'Analytics', description: 'Performance insights' },
    '/portal/shops': { title: 'Shops', description: 'Manage outlets' },
    '/portal/users': { title: 'Users', description: 'Manage users and roles' },
    '/portal/alerts': { title: 'Alerts', description: 'System alerts' },
    '/portal/settings': { title: 'Settings', description: 'Manage your portal account' },
  };

  // Find best match (exact or prefix)
  let match = routes[pathname];
  if (!match) {
    // try to match by prefix
    const prefix = Object.keys(routes).find(k => pathname.startsWith(k + '/'));
    if (prefix) match = routes[prefix];
  }

  const title = match?.title ?? 'Portal';
  const description = match?.description ?? '';

  // build breadcrumbs from pathname segments
  const segments = pathname.replace(/^\/+/, '').split('/');
  const crumbs: { label: string; href?: string }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const label = segments[i] || 'portal';
    const href = '/' + segments.slice(0, i + 1).join('/');
    crumbs.push({ label: label.replace(/-/g, ' '), href });
  }

  return (
    <div className="sticky top-0 z-40 bg-gray-50 dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700">
      <div className="w-full px-4 md:px-6 lg:px-8 mx-auto">
        <div className="flex items-center justify-between py-4">
          <div>
            <div className="flex items-center gap-3">
              <PortalBreadcrumbs breadcrumbs={crumbs as Breadcrumb[]} />
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
                {description ? <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{description}</p> : null}
              </div>
            </div>
          </div>

          <div className="ml-4 shrink-0">
            {/* Actions slot could be added via context later; for now provide a placeholder */}
            <div className="flex items-center gap-2">
              <Button variant="ghost">Help</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
