'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export type Breadcrumb = { label: string; href?: string };

type Props = {
  breadcrumbs?: Breadcrumb[];
  backHref?: string;
  className?: string;
};

export default function PortalBreadcrumbs({ breadcrumbs = [], backHref, className }: Props) {
  const router = useRouter();

  return (
    <div className={`flex items-center gap-4 ${className || ''}`}>
      {/* Back button: if backHref provided, link to it; otherwise go back in history */}
      {backHref ? (
        <Link href={backHref} className="-ml-2">
          <Button variant="ghost" size="icon" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
      ) : (
        <Button variant="ghost" size="icon" aria-label="Back" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}

      <div>
        <div className="flex items-center gap-2">
          {/* Title is expected to be rendered by the parent; breadcrumbs only show trail */}
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav aria-label="Breadcrumb" className="text-sm text-gray-500">
              {breadcrumbs.map((b, i) => (
                <span key={i} className="inline-flex items-center">
                  {i > 0 && <span className="mx-2 text-gray-300">/</span>}
                  {b.href ? (
                    <Link href={b.href} className="text-sm text-gray-600 hover:underline capitalize">
                      {b.label}
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-600 capitalize">{b.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
