'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PortalProtected } from '@/components/portal-protected';
import { useSignOut } from '@/components/portal/SignOutProvider';
import {
  Package,
  ShoppingCart,
  BarChart3,
  Settings,
  Home,
  Users,
  MapPin,
  Menu,
  X,
  Activity,
} from 'lucide-react';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  // NOTE: Do NOT call useSignOut() here — SignOutProvider is provided inside PortalProtected.
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Example: badge for alerts (could be wired to a global store later)
  const [alertsCount, setAlertsCount] = useState<number>(0);

  useEffect(() => {
    // Fetch alerts count for badge (best-effort) — endpoint should return alerts count for current user
    (async () => {
      try {
        const res = await fetch('/api/portal/alerts/count', { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (json?.success && typeof json.count === 'number') setAlertsCount(json.count);
        }
      } catch (e) {
        // ignore
      }
    })();
  }, []);

  // Close drawer on ESC and trap focus while open (basic)
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
      // basic focus trap: keep focus within drawer
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[tabindex]');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // move focus to drawer
    const timer = setTimeout(() => {
      const focusable = drawerRef.current?.querySelector<HTMLElement>('a,button');
      focusable?.focus();
    }, 0);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [drawerOpen]);

  const adminNavItems: NavItem[] = [
    { label: 'Dashboard', href: '/portal/dashboard', icon: <Home className="h-5 w-5" /> },
    { label: 'Inventory', href: '/portal/stock', icon: <Package className="h-5 w-5" /> },
    { label: 'Sales', href: '/portal/sales', icon: <ShoppingCart className="h-5 w-5" /> },
    { label: 'Analytics', href: '/portal/analytics', icon: <BarChart3 className="h-5 w-5" /> },
    { label: 'Shops', href: '/portal/shops', icon: <MapPin className="h-5 w-5" /> },
    { label: 'User Management', href: '/portal/users', icon: <Users className="h-5 w-5" /> },
    { label: 'Alerts', href: '/portal/alerts', icon: <Package className="h-5 w-5" />, badge: alertsCount },
    { label: 'Activity', href: '/portal/activity', icon: <Activity className="h-5 w-5" /> },
    { label: 'Settings', href: '/portal/settings', icon: <Settings className="h-5 w-5" /> },
  ];

  const isActive = (href: string) => {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + '/');
  };

  // Auth-only pages (login / register) must NOT be wrapped in PortalProtected
  const isAuthPage = pathname === '/portal/login' || pathname === '/portal/register';
  if (isAuthPage) {
    return <>{children}</>;
  }

  // Local component that uses the SignOutProvider's hook — must be rendered inside PortalProtected
  function SignOutTrigger({ className, children }: { className?: string; children?: React.ReactNode }) {
    const { open } = useSignOut();
    return (
      <Button variant="ghost" onClick={() => open()} className={className}>
        {children ?? 'Sign Out'}
      </Button>
    );
  }
  return (
    <PortalProtected requiredRole="portal_user" pageName="Portal">
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="w-full flex flex-col md:flex-row gap-0 min-h-0 h-screen">
          {/* Desktop sidebar - fixed to left on md+ to ensure flush alignment */}
          <aside className="hidden md:fixed md:left-0 md:top-16 md:h-[calc(100vh-4rem)] md:w-72 md:flex md:flex-col bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800" aria-label="Portal navigation">
            <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
              {adminNavItems.map((item) => (
                <Link key={item.href} href={item.href} className="group">
                  <div className={`relative flex items-center gap-3 px-3 py-2 rounded-md transition ${isActive(item.href) ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                    {/* Left active indicator */}
                    <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-r ${isActive(item.href) ? 'bg-[hsl(var(--primary))]' : 'bg-transparent group-hover:bg-gray-200 dark:group-hover:bg-gray-800'}`} />

                    <div className="p-2 rounded-md bg-gray-50 dark:bg-gray-800">
                      {item.icon}
                    </div>

                    <div className="flex-1">
                      <div className={`text-sm font-medium ${isActive(item.href) ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>{item.label}</div>
                    </div>

                    {item.badge ? (
                      <div className="ml-2 inline-flex items-center justify-center min-w-[26px] px-2 py-1 rounded-full text-xs bg-rose-100 text-rose-700">{item.badge}</div>
                    ) : null}
                  </div>
                </Link>
              ))}
            </nav>

            <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="text-xs text-gray-500">Theme</div>
                <div className="text-xs">⚪</div>
              </div>
              <div className="mt-4">
                <SignOutTrigger className="w-full text-left" />
              </div>
            </div>
          </aside>

          {/* Mobile drawer and header */}
          <div className="md:hidden w-full border-b border-gray-100 bg-white dark:bg-gray-900 dark:border-gray-800">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setDrawerOpen(true)} aria-label="Open menu" className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">
                  <Menu className="h-5 w-5" />
                </button>
              </div>
              <div>
                <SignOutTrigger />
              </div>
            </div>
            {/* Drawer overlay */}
            {drawerOpen && (
              <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
                <div ref={drawerRef} className="w-72 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 h-full p-4 overflow-y-auto" tabIndex={-1}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-sm font-semibold">Menu</div>
                    <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
                  </div>
                  <nav className="space-y-2">
                    {adminNavItems.map((item) => (
                      <Link key={item.href} href={item.href} onClick={() => setDrawerOpen(false)} className={`block px-3 py-2 rounded-md transition ${isActive(item.href) ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-md bg-gray-50 dark:bg-gray-800">{item.icon}</div>
                          <div className="text-sm font-medium">{item.label}</div>
                          {item.badge ? <div className="ml-auto inline-flex items-center justify-center min-w-[26px] px-2 py-1 rounded-full text-xs bg-rose-100 text-rose-700">{item.badge}</div> : null}
                        </div>
                      </Link>
                    ))}
                  </nav>
                  <div className="mt-6">
                    <SignOutTrigger className="w-full text-left" />
                  </div>
                </div>
                <div className="flex-1" onClick={() => setDrawerOpen(false)} />
              </div>
            )}
          </div>
          {/* Main content area */}
          <main className="flex-1 w-full pl-0 md:ml-72 min-h-0">
            {/* Inner scrollable container: page content (including PortalHeader) should sit here so the header can be sticky within this area and content below can scroll */}
            <div className="min-h-0 h-full overflow-y-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </PortalProtected>
  );
}
