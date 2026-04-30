'use client';

import React from 'react';
import PortalBreadcrumbs, { type Breadcrumb } from './PortalBreadcrumbs';

type Props = {
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: React.ReactNode;
  className?: string;
};

export default function PortalHeader({ title, description, backHref, breadcrumbs = [], actions, className }: Props) {
  return (
    <div className={`sticky top-0 z-40 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-700 ${className || ''}`}>
      <div className="px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex items-start justify-between gap-4">
          {/* Make breadcrumbs and title/description a column (stacked) */}
          <div className="flex flex-col items-start gap-2 w-full">
            <PortalBreadcrumbs className="w-full" breadcrumbs={breadcrumbs as Breadcrumb[]} backHref={backHref} />
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
              {description ? <p className="text-sm text-gray-600 mt-1">{description}</p> : null}
            </div>
          </div>

          <div className="ml-4 flex-shrink-0">
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
