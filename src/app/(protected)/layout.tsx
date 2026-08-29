'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PortalProtected } from '@/components/portal-protected';
import { useSignOut } from '@/components/portal/SignOutProvider';
import { useHydratedAuth } from '@/lib/hooks';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
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
  Search,
  LogOut,
  User,
  ChevronDown,
  Bell,
  LayoutDashboard,
  Store,
  ChevronsUpDown,
  ShieldCheck,
} from 'lucide-react';
import { usePortalStore } from '@/lib/store';
import type { Shop } from '@/lib/types';
import { loadBranding, BRANDING_EVENT, BRANDING_DEFAULTS, type BrandingConfig } from '@/lib/branding';

// ── Portal Logo (reads from branding localStorage) ────────────────────────────
function PortalLogo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const [branding, setBranding] = useState<BrandingConfig>(() =>
    typeof window !== 'undefined' ? loadBranding() : BRANDING_DEFAULTS
  );

  useEffect(() => {
    setBranding(loadBranding());
    const handler = (e: Event) => setBranding((e as CustomEvent).detail as BrandingConfig);
    window.addEventListener(BRANDING_EVENT, handler);
    return () => window.removeEventListener(BRANDING_EVENT, handler);
  }, []);

  const usingCustomLogo = Boolean(branding.logoSrc);
  const imgSrc = branding.logoSrc ?? '/favicon.png';
  const px = size === 'sm' ? 28 : 36;

  if (!usingCustomLogo) {
    // Default branding: use the full wordmark lockup (icon + name baked in)
    // instead of a separate icon + text pairing. On the "md" (top header)
    // variant, the wordmark is wide, so it only replaces the icon+text combo
    // at lg+ where there's room — below that, fall back to the compact icon
    // alone (same as before) to avoid crowding the mobile header.
    return (
      <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
        {size === 'md' && (
          <Image src="/favicon.png" alt={branding.companyName} width={px} height={px} className="object-contain lg:hidden" priority />
        )}
        <Image
          src="/logo.png"
          alt={branding.companyName}
          width={168}
          height={52}
          className={`object-contain w-auto ${size === 'md' ? 'hidden lg:block h-8' : 'h-7'}`}
          priority
        />
      </Link>
    );
  }

  return (
    <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
      <Image src={imgSrc} alt={branding.companyName} width={px} height={px} className="object-contain" priority unoptimized />
      {size === 'md' && (
        <div className="hidden lg:block">
          <p className="font-bold text-sm text-gray-900 dark:text-white leading-none">{branding.companyName}</p>
          <p className="text-[hsl(var(--primary))] text-xs leading-none mt-0.5">{branding.tagline}</p>
        </div>
      )}
      {size === 'sm' && (
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{branding.companyName}</span>
      )}
    </Link>
  );
}
interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  keywords?: string[];
}

// ── Global Search Modal ───────────────────────────────────────────────────────
function GlobalSearchModal({
  open,
  onClose,
  navItems,
}: {
  open: boolean;
  onClose: () => void;
  navItems: NavItem[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const searchLinks = [
    ...navItems.map((item) => ({ label: item.label, href: item.href, icon: item.icon, group: 'Navigation' })),
    { label: 'View Inventory Stock', href: '/stock', icon: <Package className="h-4 w-4" />, group: 'Quick Links' },
    { label: 'Record a Sale', href: '/sales', icon: <ShoppingCart className="h-4 w-4" />, group: 'Quick Links' },
    { label: 'View Analytics Report', href: '/analytics', icon: <BarChart3 className="h-4 w-4" />, group: 'Quick Links' },
    { label: 'Manage Users', href: '/users', icon: <Users className="h-4 w-4" />, group: 'Quick Links' },
    { label: 'Portal Settings', href: '/settings', icon: <Settings className="h-4 w-4" />, group: 'Quick Links' },
  ];

  const filtered = query.trim()
    ? searchLinks.filter((l) => l.label.toLowerCase().includes(query.toLowerCase()))
    : searchLinks.filter((l) => l.group === 'Navigation');

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSelect = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4" role="dialog" aria-modal="true" aria-label="Global search">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      {/* Panel */}
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent outline-none text-sm text-gray-900 dark:text-white placeholder:text-gray-400"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono text-gray-400 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">Esc</kbd>
        </div>
        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">No results for &ldquo;{query}&rdquo;</p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.href + item.label}
                type="button"
                onClick={() => handleSelect(item.href)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors group"
              >
                <span className="p-1.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 group-hover:text-[hsl(var(--primary))] group-hover:bg-[hsl(var(--primary)/0.08)] transition-colors">
                  {item.icon}
                </span>
                <span className="text-sm text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white">{item.label}</span>
                <span className="ml-auto text-xs text-gray-400">{item.group}</span>
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-800 flex items-center gap-4 text-[10px] text-gray-400">
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 font-mono">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 font-mono">↵</kbd> Open</span>
          <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 font-mono">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

// ── Shop Switcher (admin / super_admin only) ──────────────────────────────────
function ShopSwitcher({ token }: { token: string | null }) {
  const { user } = useHydratedAuth();
  const { currentShop, setCurrentShop } = usePortalStore();
  const [shops, setShops] = useState<Shop[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  useEffect(() => {
    if (!isAdmin || !token) return;
    setLoading(true);
    fetch('/api/portal/shops', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then(r => r.json())
      .then(d => { if (d.success) setShops(d.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAdmin, token]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isAdmin) return null;

  return (
    <div className="px-3 pb-3" ref={ref}>
      <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5 px-1">
        Active Shop
      </p>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 hover:border-[hsl(var(--primary)/0.5)] transition-colors group"
      >
        <div className="p-1.5 rounded-lg bg-[hsl(var(--primary)/0.1)] flex-shrink-0">
          <Store className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
        </div>
        <div className="flex-1 text-left min-w-0">
          <p className="text-xs font-semibold text-gray-900 dark:text-white truncate leading-none">
            {currentShop?.name ?? 'All Shops'}
          </p>
          <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 leading-none">
            {loading ? 'Loading…' : `${shops.length} shop${shops.length !== 1 ? 's' : ''} available`}
          </p>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="mt-1.5 w-full bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl z-50 overflow-hidden">
          {/* All Shops option (admin overview) */}
          <button
            type="button"
            onClick={() => {
              usePortalStore.getState().clearPortalContext();
              setOpen(false);
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left
              ${!currentShop
                ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
              }`}
          >
            <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 flex-shrink-0">
              <BarChart3 className="h-3.5 w-3.5 text-gray-500" />
            </div>
            <div>
              <p className="text-xs font-semibold leading-none">All Shops</p>
              <p className="text-[10px] text-gray-400 mt-0.5">Overview across all shops</p>
            </div>
            {!currentShop && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))] flex-shrink-0" />}
          </button>

          {shops.length > 0 && <div className="border-t border-gray-100 dark:border-gray-800" />}

          <div className="max-h-56 overflow-y-auto">
            {shops.map(shop => (
              <button
                key={shop.id}
                type="button"
                onClick={() => {
                  setCurrentShop(shop);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left
                  ${currentShop?.id === shop.id
                    ? 'bg-[hsl(var(--primary)/0.08)] text-[hsl(var(--primary))]'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300'
                  }`}
              >
                <div className="p-1.5 rounded-lg bg-[hsl(var(--primary)/0.1)] flex-shrink-0">
                  <Store className="h-3.5 w-3.5 text-[hsl(var(--primary))]" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-none truncate">{shop.name}</p>
                  {shop.location && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{shop.location}</p>}
                </div>
                {currentShop?.id === shop.id && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[hsl(var(--primary))] flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Profile Dropdown ──────────────────────────────────────────────────────────
function ProfileDropdown() {
  const { user } = useHydratedAuth();
  const { open: openSignOut } = useSignOut();
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Load avatar from localStorage and listen for changes made in settings
  useEffect(() => {
    if (!user?.id) return;
    const stored = localStorage.getItem(`portal-avatar-${user.id}`);
    if (stored) setAvatarUrl(stored);

    const handler = (e: Event) => {
      const { userId, url } = (e as CustomEvent).detail;
      if (userId === user.id) setAvatarUrl(url);
    };
    window.addEventListener('portal-avatar-change', handler);
    return () => window.removeEventListener('portal-avatar-change', handler);
  }, [user?.id]);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'RG';

  const roleLabel: Record<string, string> = {
    super_admin: 'Super Admin',
    admin: 'Admin',
    portal_user: 'Portal User',
    customer: 'Customer',
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Open profile menu"
        >
          {/* Avatar circle */}
          <div className="w-8 h-8 rounded-full overflow-hidden bg-[hsl(var(--primary))] flex items-center justify-center flex-shrink-0">
            {avatarUrl
              ? <Image src={avatarUrl} alt="Avatar" width={32} height={32} className="w-full h-full object-cover" unoptimized />
              : <span className="text-xs font-bold text-white">{initials}</span>
            }
          </div>
          <div className="hidden md:block text-left">
            <p className="text-xs font-semibold text-gray-900 dark:text-white leading-none truncate max-w-[120px]">
              {user?.name ?? 'Portal User'}
            </p>
            <p className="text-[10px] text-gray-500 dark:text-gray-400 leading-none mt-0.5">
              {roleLabel[user?.role ?? ''] ?? 'Portal'}
            </p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 hidden md:block" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* User info header */}
        <div className="px-3.5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-[hsl(var(--primary))] flex items-center justify-center flex-shrink-0">
            {avatarUrl
              ? <Image src={avatarUrl} alt="Avatar" width={40} height={40} className="w-full h-full object-cover" unoptimized />
              : <span className="text-sm font-bold text-white">{initials}</span>
            }
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{user?.name ?? 'Portal User'}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{user?.email ?? ''}</p>
            <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
              {roleLabel[user?.role ?? ''] ?? 'Portal'}
            </span>
          </div>
        </div>
        <div className="py-1">
          <DropdownMenuItem onClick={() => router.push('/settings')}>
            <User className="h-4 w-4 text-gray-400" />
            Profile &amp; Settings
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/dashboard')}>
            <LayoutDashboard className="h-4 w-4 text-gray-400" />
            Dashboard
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push('/alerts')}>
            <Bell className="h-4 w-4 text-gray-400" />
            Alerts
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator />
        <div className="py-1">
          <DropdownMenuItem destructive onClick={() => openSignOut()}>
            <LogOut className="h-4 w-4" />
            Sign Out
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Protected Layout ──────────────────────────────────────────────────────────
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { token, user } = useHydratedAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [alertsCount, setAlertsCount] = useState<number>(0);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch('/api/portal/alerts/count', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
        if (res.ok) {
          const json = await res.json();
          if (json?.success && typeof json.count === 'number') setAlertsCount(json.count);
        }
      } catch { /* ignore */ }
    })();
  }, [token]);

  // Cmd+K / Ctrl+K to open search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
      if (e.key === 'Tab' && drawerRef.current) {
        const focusable = drawerRef.current.querySelectorAll<HTMLElement>('a,button,input,select,textarea,[tabindex]');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const timer = setTimeout(() => { drawerRef.current?.querySelector<HTMLElement>('a,button')?.focus(); }, 0);
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(timer); };
  }, [drawerOpen]);

  const navItems: NavItem[] = [
    { label: 'Dashboard',       href: '/dashboard',  icon: <Home className="h-5 w-5" /> },
    { label: 'Inventory',       href: '/stock',       icon: <Package className="h-5 w-5" /> },
    { label: 'Sales',           href: '/sales',       icon: <ShoppingCart className="h-5 w-5" /> },
    { label: 'Analytics',       href: '/analytics',   icon: <BarChart3 className="h-5 w-5" /> },
    { label: 'Shops',           href: '/shops',       icon: <MapPin className="h-5 w-5" /> },
    { label: 'User Management', href: '/users',       icon: <Users className="h-5 w-5" /> },
    { label: 'Alerts',          href: '/alerts',      icon: <Bell className="h-5 w-5" />, badge: alertsCount },
    { label: 'Activity',        href: '/activity',    icon: <Activity className="h-5 w-5" /> },
    { label: 'Settings',        href: '/settings',    icon: <Settings className="h-5 w-5" /> },
    ...(user?.role === 'super_admin'
      ? [{ label: 'Platform', href: '/platform', icon: <ShieldCheck className="h-5 w-5" /> }]
      : []),
  ];

  const isActive = (href: string) => {
    if (!pathname) return false;
    return pathname === href || pathname.startsWith(href + '/');
  };

  function SignOutTrigger({ className, children }: { className?: string; children?: React.ReactNode }) {
    const { open } = useSignOut();
    return (
      <Button variant="ghost" onClick={() => open()} className={className}>
        {children ?? 'Sign Out'}
      </Button>
    );
  }

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  return (
    <PortalProtected requiredRole="portal_user" pageName="Portal">
      {/* Global Search Modal */}
      <GlobalSearchModal open={searchOpen} onClose={closeSearch} navItems={navItems} />

      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

        {/* ── Top header ───────────────────────────────────────── */}
        <header className="fixed top-0 left-0 right-0 z-40 h-16 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 flex items-center gap-3 px-4 md:px-6">

          {/* Hamburger — far left (mobile only) */}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex-shrink-0"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Logo */}
          <PortalLogo size="md" />

          {/* Spacer */}
          <div className="flex-1" />

          {/* ── Right actions ── */}
          <div className="flex items-center gap-2">

            {/* Global Search (right) */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden sm:flex items-center gap-2 w-48 md:w-64 h-9 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-400 hover:border-[hsl(var(--primary)/0.5)] hover:bg-white dark:hover:bg-gray-800 transition-colors text-left"
              aria-label="Open global search"
            >
              <Search className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1 truncate">Search…</span>
              <kbd className="hidden md:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-gray-400 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600">
                ⌘K
              </kbd>
            </button>

            {/* Search icon-only on mobile */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Open global search"
              className="sm:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <Search className="h-5 w-5" />
            </button>

            {/* Alerts bell */}
            <Link
              href="/alerts"
              aria-label="Alerts"
              className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex"
            >
              <Bell className="h-5 w-5" />
              {alertsCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 flex items-center justify-center text-[9px] font-bold bg-rose-500 text-white rounded-full">
                  {alertsCount > 9 ? '9+' : alertsCount}
                </span>
              )}
            </Link>


            {/* Profile */}
            <ProfileDropdown />
          </div>
        </header>

        <div className="w-full flex flex-col md:flex-row gap-0 min-h-0 h-screen pt-16">
          {/* Desktop sidebar */}
          <aside className="hidden md:fixed md:left-0 md:top-16 md:h-[calc(100vh-4rem)] md:w-72 md:flex md:flex-col bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800" aria-label="Portal navigation">
            {/* Shop switcher for admins */}
            <div className="pt-4">
              <ShopSwitcher token={token} />
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="group">
                  <div className={`relative flex items-center gap-3 px-3 py-2 rounded-md transition ${isActive(item.href) ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                    <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-r ${isActive(item.href) ? 'bg-[hsl(var(--primary))]' : 'bg-transparent group-hover:bg-gray-200 dark:group-hover:bg-gray-800'}`} />
                    <div className="p-2 rounded-md bg-gray-50 dark:bg-gray-800">{item.icon}</div>
                    <div className="flex-1">
                      <div className={`text-sm font-medium ${isActive(item.href) ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>{item.label}</div>
                    </div>
                    {item.badge ? <div className="ml-2 inline-flex items-center justify-center min-w-[26px] px-2 py-1 rounded-full text-xs bg-rose-100 text-rose-700">{item.badge}</div> : null}
                  </div>
                </Link>
              ))}
            </nav>
            <div className="px-4 py-4 border-t border-gray-100 dark:border-gray-800">
              <SignOutTrigger className="w-full text-left" />
            </div>
          </aside>

          {/* Mobile drawer */}
          {drawerOpen && (
            <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true">
              <div ref={drawerRef} className="w-72 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 h-full p-4 overflow-y-auto" tabIndex={-1}>
                <div className="flex items-center justify-between mb-4">
                  <PortalLogo size="sm" />
                  <button onClick={() => setDrawerOpen(false)} aria-label="Close menu" className="p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {/* Search in drawer */}
                <button
                  type="button"
                  onClick={() => { setDrawerOpen(false); setSearchOpen(true); }}
                  className="w-full flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-400"
                >
                  <Search className="h-4 w-4" />
                  <span>Search…</span>
                </button>
                {/* Shop switcher */}
                <div className="mb-2">
                  <ShopSwitcher token={token} />
                </div>
                <nav className="space-y-2">
                  {navItems.map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setDrawerOpen(false)} className={`block px-3 py-2 rounded-md transition ${isActive(item.href) ? 'bg-gray-100 dark:bg-gray-800' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-gray-50 dark:bg-gray-800">{item.icon}</div>
                        <div className="text-sm font-medium">{item.label}</div>
                        {item.badge ? <div className="ml-auto inline-flex items-center justify-center min-w-[26px] px-2 py-1 rounded-full text-xs bg-rose-100 text-rose-700">{item.badge}</div> : null}
                      </div>
                    </Link>
                  ))}
                </nav>
                <div className="mt-4">
                  <SignOutTrigger className="w-full text-left" />
                </div>
              </div>
              <div className="flex-1" onClick={() => setDrawerOpen(false)} />
            </div>
          )}

          {/* Main content */}
          <main className="flex-1 w-full pl-0 md:ml-72 min-h-0">
            <div className="min-h-0 h-full overflow-y-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </PortalProtected>
  );
}

