'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useHydratedAuth } from '@/lib/hooks';
import { usePortalStore } from '@/lib/store';
import { useTheme } from '@/lib/theme-context';
import { toast } from 'sonner';
import {
  User,
  Lock,
  Palette,
  Store,
  Bell,
  Info,
  Check,
  Eye,
  EyeOff,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
  LogOut,
  Mail,
  Phone,
  MapPin,
  ChevronRight,
  Camera,
  ImageIcon,
  RotateCcw,
  CreditCard,
  Globe,
  Plug,
} from 'lucide-react';
import { useSignOut } from '@/components/portal/SignOutProvider';
import { loadBranding, saveBranding, resetBranding, type BrandingConfig } from '@/lib/branding';
import { getCurrentOrganization } from '@/lib/organizations';
import {
  startBillingCheckout,
  verifyBillingReference,
  getBillingSubscription,
  cancelBillingSubscription,
  listPublicPlans,
  type SubscriptionSnapshot,
  type PublicPlan,
} from '@/lib/billing';
import { getDomainState, removeDomain, setDomain, type DomainState } from '@/lib/domains';
import type { Organization } from '@/lib/types';
import { PlanBadge } from '@/components/entitlements/PlanBadge';
import { SubscriptionStatusBadge } from '@/components/entitlements/SubscriptionStatusBadge';
import { UsageSummary } from '@/components/entitlements/UsageSummary';
import { InvoicePreview } from '@/components/entitlements/InvoicePreview';
import { PlanComparison } from '@/components/entitlements/PlanComparison';
import { FeatureGate } from '@/components/entitlements/FeatureGate';
import { FeatureCode } from '@/lib/entitlements/feature-codes';
import {
  getMpesaConfig, setMpesaConfig, removeMpesaConfig, type MpesaConfigSummary,
  getTaxProfile, setTaxProfile,
  getQuickBooksStatus, getQuickBooksAuthorizationUrl, disconnectQuickBooks, type QuickBooksStatus,
} from '@/lib/integrations';

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'profile',     label: 'Profile',      icon: User },
  { id: 'appearance',  label: 'Appearance',   icon: Palette },
  { id: 'security',    label: 'Security',     icon: Lock },
  { id: 'shop',        label: 'Shop Info',    icon: Store },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'billing',     label: 'Billing',      icon: CreditCard },
  { id: 'domain',      label: 'Domain',       icon: Globe },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'about',       label: 'About',        icon: Info },
] as const;

type TabId = typeof TABS[number]['id'];

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
      <div className="px-6 py-5 border-b border-[hsl(var(--border))]">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h2>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

// ── Field row ─────────────────────────────────────────────────────────────────
function FieldRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="grid sm:grid-cols-3 gap-2 sm:gap-4 items-start py-4 border-b border-[hsl(var(--border))] last:border-0">
      <div>
        <Label className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</Label>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="sm:col-span-2">{children}</div>
    </div>
  );
}

// ── Theme option card ─────────────────────────────────────────────────────────
function ThemeCard({
  label, icon: Icon, active, onClick, preview,
}: {
  label: string; icon: React.ElementType; active: boolean; onClick: () => void;
  preview: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex flex-col gap-3 p-4 rounded-xl border-2 transition-all text-left w-full
        ${active
          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] shadow-sm'
          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--primary)/0.4)] bg-white dark:bg-gray-900'
        }`}
    >
      {/* Mini preview */}
      <div className="w-full h-20 rounded-lg overflow-hidden border border-[hsl(var(--border))] flex-shrink-0">
        {preview}
      </div>
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      </div>
      {active && (
        <span className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[hsl(var(--primary))] flex items-center justify-center">
          <Check className="h-3 w-3 text-white" />
        </span>
      )}
    </button>
  );
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-2
        ${checked ? 'bg-[hsl(var(--primary))]' : 'bg-gray-200 dark:bg-gray-700'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

// ── Notification row ──────────────────────────────────────────────────────────
function NotifRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-4 border-b border-[hsl(var(--border))] last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{desc}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PortalSettingsPage() {
  const { user, token, setAuth } = useHydratedAuth();
  const { currentShop, currentPortalUser } = usePortalStore();
  const { theme, toggleTheme } = useTheme();
  const { open: openSignOut } = useSignOut();

  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('dark');
  const [accentHsl, setAccentHsl] = useState<string>('271 81% 56%');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [branding, setBranding] = useState<BrandingConfig>({ logoSrc: null, companyName: 'Royal Gene', tagline: 'Management Portal' });

  const [profileForm, setProfileForm] = useState({ name: '', phone: '' });
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [notifs, setNotifs] = useState({
    lowStock: true,
    newSale: true,
    dailySummary: false,
    systemAlerts: true,
  });

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [billingPlans, setBillingPlans] = useState<PublicPlan[]>([]);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annually'>('monthly');
  const [checkoutBusyId, setCheckoutBusyId] = useState<string | null>(null);
  const [subscriptionSnapshot, setSubscriptionSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  // Land directly on the Billing tab and confirm a Paystack checkout when
  // the browser returns via the callback URL (?tab=billing&reference=...).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'billing') setActiveTab('billing');
    const reference = params.get('reference');
    if (reference && token) {
      verifyBillingReference(token, reference).then((res) => {
        if (res.success && res.data?.status === 'success') {
          toast.success('Subscription activated!');
          getCurrentOrganization(token).then((r) => { if (r.success && r.data) setOrganization(r.data); });
        } else if (res.success) {
          toast.info(`Payment status: ${res.data?.status}`);
        }
      });
    }
  }, [token]);

  useEffect(() => {
    if (activeTab !== 'billing' || !token || billingPlans.length > 0) return;
    setBillingLoading(true);
    Promise.all([getCurrentOrganization(token), listPublicPlans(), getBillingSubscription(token)]).then(([orgRes, plansRes, subRes]) => {
      if (orgRes.success && orgRes.data) setOrganization(orgRes.data);
      if (plansRes.success && plansRes.data) setBillingPlans(plansRes.data);
      if (subRes.success && subRes.data) setSubscriptionSnapshot(subRes.data);
      setBillingLoading(false);
    });
  }, [activeTab, token, billingPlans.length]);

  const isBillingAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const handleUpgrade = async (plan: PublicPlan) => {
    setCheckoutBusyId(plan.id);
    const res = await startBillingCheckout(token, plan.id, billingInterval);
    if (res.success && res.data?.checkoutUrl) {
      window.location.href = res.data.checkoutUrl;
    } else {
      toast.error(res.error || 'Failed to start checkout');
      setCheckoutBusyId(null);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelBusy(true);
    const res = await cancelBillingSubscription(token);
    if (res.success) {
      toast.success('Subscription cancelled. Your data is safe — resubscribe anytime.');
      const subRes = await getBillingSubscription(token);
      if (subRes.success && subRes.data) setSubscriptionSnapshot(subRes.data);
    } else {
      toast.error(res.error || 'Failed to cancel subscription');
    }
    setCancelBusy(false);
  };

  const [domainState, setDomainState] = useState<DomainState | null>(null);
  const [domainLoading, setDomainLoading] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [domainBusy, setDomainBusy] = useState(false);

  const loadDomainState = () => {
    if (!token) return;
    setDomainLoading(true);
    getDomainState(token).then((res) => {
      if (res.success && res.data) setDomainState(res.data);
      setDomainLoading(false);
    });
  };

  useEffect(() => {
    if (activeTab !== 'domain' || !token || domainState) return;
    loadDomainState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, token]);

  const handleSetDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput.trim()) return;
    setDomainBusy(true);
    const res = await setDomain(token, domainInput.trim());
    if (res.success && res.data) {
      setDomainState(res.data);
      setDomainInput('');
      toast.success('Domain added — follow the DNS instructions below to finish setup');
    } else {
      toast.error(res.error || 'Failed to add domain');
    }
    setDomainBusy(false);
  };

  const handleRemoveDomain = async () => {
    setDomainBusy(true);
    const res = await removeDomain(token);
    if (res.success) {
      setDomainState({ domain: null, status: null, instructions: null });
      toast.success('Domain removed');
    } else {
      toast.error(res.error || 'Failed to remove domain');
    }
    setDomainBusy(false);
  };

  // ── M-Pesa integration (Integrations tab) ──────────────────────────────
  const [mpesaConfig, setMpesaConfigState] = useState<MpesaConfigSummary | null>(null);
  const [mpesaLoading, setMpesaLoading] = useState(false);
  const [mpesaBusy, setMpesaBusy] = useState(false);
  const [mpesaForm, setMpesaForm] = useState({
    consumerKey: '', consumerSecret: '', businessShortCode: '', passkey: '',
    environment: 'sandbox' as 'sandbox' | 'production', callbackUrl: '',
  });

  useEffect(() => {
    if (activeTab !== 'integrations' || !token) return;
    setMpesaLoading(true);
    getMpesaConfig(token).then((res) => {
      if (res.success) setMpesaConfigState(res.data ?? null);
      setMpesaLoading(false);
    });
  }, [activeTab, token]);

  const handleSaveMpesaConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setMpesaBusy(true);
    const res = await setMpesaConfig(token, mpesaForm);
    if (res.success) {
      setMpesaConfigState(res.data ?? null);
      setMpesaForm({ consumerKey: '', consumerSecret: '', businessShortCode: '', passkey: '', environment: 'sandbox', callbackUrl: '' });
      toast.success('M-Pesa credentials saved');
    } else {
      toast.error(res.error || 'Failed to save M-Pesa credentials');
    }
    setMpesaBusy(false);
  };

  const handleRemoveMpesaConfig = async () => {
    setMpesaBusy(true);
    const res = await removeMpesaConfig(token);
    if (res.success) {
      setMpesaConfigState(null);
      toast.success('M-Pesa credentials removed');
    } else {
      toast.error(res.error || 'Failed to remove M-Pesa credentials');
    }
    setMpesaBusy(false);
  };

  // ── eTIMS tax profile (Integrations tab) ───────────────────────────────
  const [kraPin, setKraPinState] = useState<string | null>(null);
  const [kraPinInput, setKraPinInput] = useState('');
  const [kraPinLoading, setKraPinLoading] = useState(false);
  const [kraPinBusy, setKraPinBusy] = useState(false);

  useEffect(() => {
    if (activeTab !== 'integrations' || !token) return;
    setKraPinLoading(true);
    getTaxProfile(token).then((res) => {
      if (res.success) setKraPinState(res.data?.kraPin ?? null);
      setKraPinLoading(false);
    });
  }, [activeTab, token]);

  const handleSaveKraPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!kraPinInput.trim()) return;
    setKraPinBusy(true);
    const res = await setTaxProfile(token, kraPinInput.trim());
    if (res.success) {
      setKraPinState(res.data?.kraPin ?? null);
      setKraPinInput('');
      toast.success('KRA PIN saved — new sales will generate tax invoices');
    } else {
      toast.error(res.error || 'Failed to save KRA PIN');
    }
    setKraPinBusy(false);
  };

  // ── QuickBooks Online (Integrations tab) ───────────────────────────────
  const [qbStatus, setQbStatus] = useState<QuickBooksStatus | null>(null);
  const [qbLoading, setQbLoading] = useState(false);
  const [qbBusy, setQbBusy] = useState(false);

  const loadQuickBooksStatus = () => {
    if (!token) return;
    setQbLoading(true);
    getQuickBooksStatus(token).then((res) => {
      if (res.success && res.data) setQbStatus(res.data);
      setQbLoading(false);
    });
  };

  useEffect(() => {
    if (activeTab !== 'integrations' || !token) return;
    loadQuickBooksStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, token]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'integrations') setActiveTab('integrations');
    const qb = params.get('qb');
    if (qb === 'connected') toast.success('QuickBooks connected');
    else if (qb === 'error') toast.error('Failed to connect QuickBooks — please try again');
  }, []);

  const handleConnectQuickBooks = async () => {
    setQbBusy(true);
    const res = await getQuickBooksAuthorizationUrl(token);
    if (res.success && res.data?.authorizationUrl) {
      window.location.href = res.data.authorizationUrl;
    } else {
      toast.error(res.error || 'Failed to start QuickBooks connection');
      setQbBusy(false);
    }
  };

  const handleDisconnectQuickBooks = async () => {
    setQbBusy(true);
    const res = await disconnectQuickBooks(token);
    if (res.success) {
      setQbStatus({ connected: false, realmId: null, connectedAt: null, platformConfigured: qbStatus?.platformConfigured ?? true });
      toast.success('QuickBooks disconnected');
    } else {
      toast.error(res.error || 'Failed to disconnect QuickBooks');
    }
    setQbBusy(false);
  };

  useEffect(() => {
    setMounted(true);
    if (user) {
      setProfileForm({ name: user.name || '', phone: user.phone || '' });
      const savedAvatar = localStorage.getItem(`portal-avatar-${user.id}`);
      if (savedAvatar) setAvatarUrl(savedAvatar);
    }
    const savedTheme = (typeof window !== 'undefined' ? localStorage.getItem('theme') : null) as 'light' | 'dark' | null;
    setThemeMode(savedTheme ?? 'dark');
    const savedAccent = typeof window !== 'undefined' ? localStorage.getItem('accent-hsl') : null;
    if (savedAccent) {
      setAccentHsl(savedAccent);
      document.documentElement.style.setProperty('--primary', savedAccent);
    }
    setBranding(loadBranding());
  }, [user]);

  const applyAccent = (hsl: string) => {
    setAccentHsl(hsl);
    document.documentElement.style.setProperty('--primary', hsl);
    localStorage.setItem('accent-hsl', hsl);
    toast.success('Accent colour updated');
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be smaller than 2 MB'); return; }
    setAvatarUploading(true);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      // Resize to max 256×256 via canvas
      const img = new window.Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        const resized = canvas.toDataURL('image/jpeg', 0.85);
        localStorage.setItem(`portal-avatar-${user.id}`, resized);
        // Dispatch custom event so header dropdown updates live
        window.dispatchEvent(new CustomEvent('portal-avatar-change', { detail: { userId: user.id, url: resized } }));
        setAvatarUrl(resized);
        setAvatarUploading(false);
        toast.success('Profile photo updated');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    // Reset input so same file can be re-selected
    e.target.value = '';
  };

  const handleRemoveAvatar = () => {
    if (!user) return;
    localStorage.removeItem(`portal-avatar-${user.id}`);
    window.dispatchEvent(new CustomEvent('portal-avatar-change', { detail: { userId: user.id, url: null } }));
    setAvatarUrl(null);
    toast.success('Profile photo removed');
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('Image must be smaller than 2 MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        const scale = Math.min(size / img.width, size / img.height);
        const w = img.width * scale; const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        const resized = canvas.toDataURL('image/png');
        const next = saveBranding({ logoSrc: resized });
        setBranding(next);
        toast.success('Logo updated');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleBrandingTextSave = () => {
    const next = saveBranding({ companyName: branding.companyName, tagline: branding.tagline });
    setBranding(next);
    toast.success('Branding saved');
  };

  const handleResetBranding = () => {
    resetBranding();
    setBranding(loadBranding());
    toast.success('Branding reset to defaults');
  };

  const handleThemeSelect = (mode: 'light' | 'dark' | 'system') => {
    setThemeMode(mode);
    if (mode === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if ((prefersDark && theme === 'light') || (!prefersDark && theme === 'dark')) toggleTheme();
      localStorage.removeItem('theme');
    } else {
      if (mode !== theme) toggleTheme();
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const prev = user;
    try {
      if (setAuth && user) setAuth({ ...user, name: profileForm.name, phone: profileForm.phone }, token || '');
      const res = await fetch('/api/portal/settings/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: profileForm.name, phone: profileForm.phone }),
      });
      const data = await res.json();
      if (data.success) {
        if (setAuth && user) setAuth({ ...user, ...data.data }, token || '');
        setSaved(true);
        toast.success('Profile updated');
        setTimeout(() => setSaved(false), 3000);
      } else {
        if (setAuth && prev) setAuth(prev, token || '');
        toast.error(data.error || 'Update failed');
      }
    } catch {
      if (setAuth && prev) setAuth(prev, token || '');
      toast.error('An error occurred');
    } finally { setLoading(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) { toast.error('Passwords do not match'); return; }
    if (pwForm.next.length < 8) { toast.error('Minimum 8 characters'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/portal/settings/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success('Password changed');
        setPwForm({ current: '', next: '', confirm: '' });
      } else {
        toast.error(data.error || 'Failed to change password');
      }
    } catch { toast.error('An error occurred'); }
    finally { setLoading(false); }
  };

  if (!mounted || !user) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-[hsl(var(--primary))] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const initials = user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'RG';
  const roleLabel: Record<string, string> = { super_admin: 'Super Admin', admin: 'Admin', portal_user: 'Portal User', customer: 'Customer' };

  // Light preview
  const lightPreview = (
    <div className="w-full h-full bg-white flex flex-col p-2 gap-1">
      <div className="flex gap-1"><div className="w-8 h-1.5 rounded bg-gray-800" /><div className="w-5 h-1.5 rounded bg-gray-300" /></div>
      <div className="flex gap-1 mt-1"><div className="w-3 h-8 rounded bg-gray-100 border border-gray-200" /><div className="flex-1"><div className="w-full h-2 rounded bg-gray-100 mb-1" /><div className="w-3/4 h-2 rounded bg-gray-100" /></div></div>
      <div className="mt-1 w-12 h-3 rounded bg-violet-500" />
    </div>
  );
  const darkPreview = (
    <div className="w-full h-full bg-gray-950 flex flex-col p-2 gap-1">
      <div className="flex gap-1"><div className="w-8 h-1.5 rounded bg-white" /><div className="w-5 h-1.5 rounded bg-gray-700" /></div>
      <div className="flex gap-1 mt-1"><div className="w-3 h-8 rounded bg-gray-800 border border-gray-700" /><div className="flex-1"><div className="w-full h-2 rounded bg-gray-800 mb-1" /><div className="w-3/4 h-2 rounded bg-gray-800" /></div></div>
      <div className="mt-1 w-12 h-3 rounded bg-violet-500" />
    </div>
  );
  const systemPreview = (
    <div className="w-full h-full flex">
      <div className="w-1/2 bg-white p-2"><div className="w-full h-1.5 rounded bg-gray-200 mb-1" /><div className="w-8 h-3 rounded bg-violet-400" /></div>
      <div className="w-1/2 bg-gray-950 p-2"><div className="w-full h-1.5 rounded bg-gray-700 mb-1" /><div className="w-8 h-3 rounded bg-violet-500" /></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Page header — sticky */}
      <div className="sticky top-0 z-30 bg-white dark:bg-gray-900 border-b border-[hsl(var(--border))] shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          {/* Avatar + user summary */}
          <div className="flex items-center gap-4">
            {/* Clickable avatar */}
            <div className="relative flex-shrink-0 group">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarChange}
              />
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-[hsl(var(--primary)/0.3)] focus:outline-none focus:ring-[hsl(var(--primary))] transition-all"
                aria-label="Change profile photo"
              >
                {avatarUrl ? (
                  <Image src={avatarUrl} alt="Profile" width={64} height={64} className="w-full h-full object-cover" unoptimized />
                ) : (
                  <div className="w-full h-full bg-[hsl(var(--primary))] flex items-center justify-center">
                    <span className="text-xl font-bold text-white">{initials}</span>
                  </div>
                )}
                {/* Hover overlay */}
                <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  {avatarUploading
                    ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Camera className="h-5 w-5 text-white" />
                  }
                </div>
              </button>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{user.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-gray-500 dark:text-gray-400">{user.email}</span>
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]">
                  {roleLabel[user.role] ?? 'Portal'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                className="mt-1.5 text-xs text-[hsl(var(--primary))] hover:underline"
              >
                {avatarUrl ? 'Change photo' : 'Upload photo'}
              </button>
              {avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="ml-3 mt-1.5 text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tab row */}
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="flex gap-1 overflow-x-auto scrollbar-none -mb-px">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors
                    ${active
                      ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300'
                    }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">

        {/* ── PROFILE ────────────────────────────────────────────── */}
        {activeTab === 'profile' && (
          <>
            <Section title="Profile Photo" description="Click the avatar or the button to upload a new photo. Max 2 MB, any image format.">
              <div className="flex items-center gap-5">
                {/* Avatar preview */}
                <div className="relative group flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-[hsl(var(--primary)/0.25)] hover:ring-[hsl(var(--primary))] focus:outline-none transition-all"
                    aria-label="Change profile photo"
                  >
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt="Profile" width={80} height={80} className="w-full h-full object-cover" unoptimized />
                    ) : (
                      <div className="w-full h-full bg-[hsl(var(--primary))] flex items-center justify-center">
                        <span className="text-2xl font-bold text-white">{initials}</span>
                      </div>
                    )}
                    <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      {avatarUploading
                        ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        : <Camera className="h-5 w-5 text-white" />
                      }
                    </div>
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                  >
                    <Camera className="h-4 w-4 mr-2" />
                    {avatarUploading ? 'Uploading…' : avatarUrl ? 'Change Photo' : 'Upload Photo'}
                  </Button>
                  {avatarUrl && (
                    <Button type="button" variant="ghost" onClick={handleRemoveAvatar} className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
                      Remove Photo
                    </Button>
                  )}
                  <p className="text-xs text-gray-400 dark:text-gray-500">JPG, PNG, GIF · Max 2 MB</p>
                </div>
              </div>
            </Section>
            <Section title="Personal Information" description="Update your name and contact details.">
              <form onSubmit={handleUpdateProfile}>
                <FieldRow label="Full Name">
                  <Input
                    value={profileForm.name}
                    onChange={e => setProfileForm(p => ({ ...p, name: e.target.value }))}
                    disabled={loading}
                    placeholder="Your full name"
                  />
                </FieldRow>
                <FieldRow label="Email Address" hint="Cannot be changed">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input value={user.email} disabled className="pl-9 opacity-60 cursor-not-allowed" />
                  </div>
                </FieldRow>
                <FieldRow label="Phone Number">
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      value={profileForm.phone}
                      onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))}
                      disabled={loading}
                      placeholder="+254 7XX XXX XXX"
                      className="pl-9"
                    />
                  </div>
                </FieldRow>
                <div className="flex items-center gap-3 pt-4">
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Saving…' : 'Save Changes'}
                  </Button>
                  {saved && (
                    <span className="inline-flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400 font-medium">
                      <Check className="h-4 w-4" /> Saved
                    </span>
                  )}
                </div>
              </form>
            </Section>

            <Section title="Account Details" description="Your role and account metadata.">
              <div className="space-y-3">
                {[
                  { label: 'Role', value: roleLabel[user.role] ?? user.role },
                  { label: 'User ID', value: user.id },
                  { label: 'Member since', value: new Date(user.createdAt).toLocaleDateString('en-KE', { year: 'numeric', month: 'long', day: 'numeric' }) },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-3 border-b border-[hsl(var(--border))] last:border-0">
                    <span className="text-sm text-gray-500 dark:text-gray-400">{row.label}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white font-mono">{row.value}</span>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}

        {/* ── APPEARANCE ─────────────────────────────────────────── */}
        {activeTab === 'appearance' && (
          <>
            <Section title="Theme" description="Choose how the portal looks. Your preference is saved to this browser.">
              <div className="grid grid-cols-3 gap-4 pt-2">
                <ThemeCard label="Light" icon={Sun} active={themeMode === 'light'} onClick={() => handleThemeSelect('light')} preview={lightPreview} />
                <ThemeCard label="Dark" icon={Moon} active={themeMode === 'dark'} onClick={() => handleThemeSelect('dark')} preview={darkPreview} />
                <ThemeCard label="System" icon={Monitor} active={themeMode === 'system'} onClick={() => handleThemeSelect('system')} preview={systemPreview} />
              </div>
            </Section>

            <Section title="Density" description="Adjust the spacing of the interface.">
              <div className="flex gap-3">
                {(['Compact', 'Default', 'Comfortable'] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    className={`flex-1 py-3 rounded-xl border-2 text-sm font-medium transition-all
                      ${d === 'Default'
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.06)] text-[hsl(var(--primary))]'
                        : 'border-[hsl(var(--border))] text-gray-500 dark:text-gray-400 hover:border-[hsl(var(--primary)/0.4)]'
                      }`}
                  >
                    {d === 'Default' && <Check className="h-3.5 w-3.5 inline mr-1.5" />}
                    {d}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-3">Density controls are coming soon. Default is active.</p>
            </Section>

            <Section title="Accent Colour" description="Customise the portal's primary brand colour. Changes apply instantly.">
              <div className="flex gap-3 flex-wrap">
                {[
                  { name: 'Purple',  hsl: '271 81% 56%' },
                  { name: 'Indigo',  hsl: '243 75% 59%' },
                  { name: 'Blue',    hsl: '217 91% 60%' },
                  { name: 'Rose',    hsl: '347 77% 55%' },
                  { name: 'Amber',   hsl: '38 92% 50%'  },
                  { name: 'Emerald', hsl: '152 76% 40%' },
                ].map(c => {
                  const isActive = accentHsl === c.hsl;
                  return (
                    <button
                      key={c.name}
                      type="button"
                      title={c.name}
                      onClick={() => applyAccent(c.hsl)}
                      className={`relative w-10 h-10 rounded-full border-2 border-white dark:border-gray-900 transition-all hover:scale-110 focus:outline-none
                        ${isActive ? 'scale-110 outline outline-[3px] outline-offset-2' : 'hover:outline hover:outline-2 hover:outline-offset-2'}`}
                      style={{ background: `hsl(${c.hsl})`, outlineColor: `hsl(${c.hsl})` }}
                    >
                      {isActive && (
                        <Check className="h-4 w-4 text-white absolute inset-0 m-auto drop-shadow" />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-4">
                Selected: <span className="font-medium text-gray-600 dark:text-gray-300" style={{ color: `hsl(${accentHsl})` }}>
                  {(['Purple','Indigo','Blue','Rose','Amber','Emerald'].find(
                    (_, i) => ['271 81% 56%','243 75% 59%','217 91% 60%','347 77% 55%','38 92% 50%','152 76% 40%'][i] === accentHsl
                  )) ?? 'Custom'}
                </span>
              </p>
            </Section>

            {/* ── Branding ── */}
            <Section title="Branding" description="Customise the logo, name, and tagline shown in the portal header. Stored in this browser.">
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />

              {/* Logo upload */}
              <div className="flex items-center gap-5 pb-5 border-b border-[hsl(var(--border))]">
                {/* Preview */}
                <button
                  type="button"
                  onClick={() => logoInputRef.current?.click()}
                  className="relative w-16 h-16 rounded-2xl overflow-hidden border-2 border-dashed border-[hsl(var(--border))] hover:border-[hsl(var(--primary))] flex items-center justify-center bg-gray-50 dark:bg-gray-800 transition-all group flex-shrink-0"
                >
                  {branding.logoSrc ? (
                    <Image src={branding.logoSrc} alt="Logo" width={64} height={64} className="w-full h-full object-contain p-1" unoptimized />
                  ) : (
                    <Image src="/favicon.png" alt="Default logo" width={40} height={40} className="object-contain opacity-50" />
                  )}
                  <div className="absolute inset-0 rounded-2xl bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera className="h-5 w-5 text-white" />
                  </div>
                </button>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => logoInputRef.current?.click()}>
                      <ImageIcon className="h-4 w-4 mr-2" />
                      {branding.logoSrc ? 'Change Logo' : 'Upload Logo'}
                    </Button>
                    {branding.logoSrc && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => { const n = saveBranding({ logoSrc: null }); setBranding(n); toast.success('Logo removed'); }}
                        className="text-red-500 hover:text-red-600"
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">PNG, SVG, JPG · Max 2 MB · Displayed at 36×36 px</p>
                </div>
              </div>

              {/* Company name + tagline */}
              <div className="pt-4 space-y-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Company Name</Label>
                  <Input
                    value={branding.companyName}
                    onChange={e => setBranding(b => ({ ...b, companyName: e.target.value }))}
                    placeholder="Royal Gene"
                    maxLength={40}
                  />
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5 block">Tagline</Label>
                  <Input
                    value={branding.tagline}
                    onChange={e => setBranding(b => ({ ...b, tagline: e.target.value }))}
                    placeholder="Management Portal"
                    maxLength={60}
                  />
                </div>

                {/* Live preview */}
                <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-3 pt-2.5 pb-1.5">Preview</p>
                  <div className="flex items-center gap-2 px-3 pb-3">
                    <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center bg-gray-50 dark:bg-gray-800 border border-[hsl(var(--border))] flex-shrink-0">
                      {branding.logoSrc
                        ? <Image src={branding.logoSrc} alt="Logo preview" width={36} height={36} className="w-full h-full object-contain p-0.5" unoptimized />
                        : <Image src="/favicon.png" alt="Default" width={28} height={28} className="object-contain" />
                      }
                    </div>
                    <div>
                      <p className="font-bold text-sm text-gray-900 dark:text-white leading-none">{branding.companyName || 'Company Name'}</p>
                      <p className="text-[hsl(var(--primary))] text-xs leading-none mt-0.5">{branding.tagline || 'Tagline'}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <Button type="button" onClick={handleBrandingTextSave}>Save Branding</Button>
                  <Button type="button" variant="ghost" onClick={handleResetBranding} className="text-gray-500">
                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                    Reset to Default
                  </Button>
                </div>
              </div>
            </Section>
          </>
        )}

        {/* ── SECURITY ───────────────────────────────────────────── */}
        {activeTab === 'security' && (
          <>
            <Section title="Change Password" description="Use a strong password of at least 8 characters.">
              <form onSubmit={handleChangePassword}>
                <FieldRow label="Current Password">
                  <div className="relative">
                    <Input
                      type={showCurrentPw ? 'text' : 'password'}
                      value={pwForm.current}
                      onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
                      disabled={loading}
                      placeholder="••••••••"
                      className="pr-10"
                    />
                    <button type="button" tabIndex={-1} onClick={() => setShowCurrentPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      {showCurrentPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FieldRow>
                <FieldRow label="New Password" hint="Min. 8 characters">
                  <div className="relative">
                    <Input
                      type={showNewPw ? 'text' : 'password'}
                      value={pwForm.next}
                      onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
                      disabled={loading}
                      placeholder="••••••••"
                      className="pr-10"
                    />
                    <button type="button" tabIndex={-1} onClick={() => setShowNewPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {/* Password strength bar */}
                  {pwForm.next && (
                    <div className="mt-2 flex gap-1">
                      {[1,2,3,4].map(n => (
                        <div key={n} className={`h-1 flex-1 rounded-full transition-colors ${
                          pwForm.next.length >= n * 3
                            ? n <= 2 ? 'bg-red-400' : n === 3 ? 'bg-yellow-400' : 'bg-green-500'
                            : 'bg-gray-200 dark:bg-gray-700'
                        }`} />
                      ))}
                    </div>
                  )}
                </FieldRow>
                <FieldRow label="Confirm Password">
                  <Input
                    type="password"
                    value={pwForm.confirm}
                    onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
                    disabled={loading}
                    placeholder="••••••••"
                  />
                  {pwForm.confirm && pwForm.next !== pwForm.confirm && (
                    <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                  )}
                </FieldRow>
                <div className="pt-4">
                  <Button type="submit" disabled={loading || !pwForm.current || !pwForm.next || pwForm.next !== pwForm.confirm}>
                    {loading ? 'Updating…' : 'Update Password'}
                  </Button>
                </div>
              </form>
            </Section>

            <Section title="Active Sessions" description="You are currently signed in on 1 device.">
              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[hsl(var(--primary)/0.1)]">
                    <Monitor className="h-5 w-5 text-[hsl(var(--primary))]" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">Current browser</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Active now</p>
                  </div>
                </div>
                <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">This device</span>
              </div>
            </Section>

            <Section title="Danger Zone" description="Irreversible account actions.">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">Sign out of portal</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">You will need to sign in again to access the portal.</p>
                </div>
                <Button variant="destructive" onClick={() => openSignOut()}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </Button>
              </div>
            </Section>
          </>
        )}

        {/* ── SHOP INFO ──────────────────────────────────────────── */}
        {activeTab === 'shop' && (
          <>
            <Section title="Assigned Shop" description="The shop assigned to your portal account.">
              {currentShop ? (
                <div className="space-y-0">
                  {[
                    { icon: Store, label: 'Shop Name', value: currentShop.name },
                    { icon: MapPin, label: 'Location', value: currentShop.location || '—' },
                    { icon: User, label: 'Your Position', value: currentPortalUser?.position || '—' },
                    { icon: ShieldCheck, label: 'Portal User Status', value: currentPortalUser?.isActive ? 'Active' : 'Inactive' },
                  ].map(row => (
                    <div key={row.label} className="flex items-center gap-4 py-4 border-b border-[hsl(var(--border))] last:border-0">
                      <div className="p-2 rounded-lg bg-[hsl(var(--primary)/0.1)] flex-shrink-0">
                        <row.icon className="h-4 w-4 text-[hsl(var(--primary))]" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-gray-500 dark:text-gray-400">{row.label}</p>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{row.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10">
                  <Store className="h-10 w-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">No shop assigned to your account.</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Contact your administrator to be assigned to a shop.</p>
                </div>
              )}
            </Section>

            {(user.role === 'admin' || user.role === 'super_admin') && (
              <Section title="Admin Access" description="You have elevated privileges.">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-[hsl(var(--primary)/0.08)] border border-[hsl(var(--primary)/0.2)]">
                  <ShieldCheck className="h-6 w-6 text-[hsl(var(--primary))]" />
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {user.role === 'super_admin' ? 'Super Administrator' : 'Administrator'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">You can manage all shops, users, and portal settings.</p>
                  </div>
                </div>
              </Section>
            )}
          </>
        )}

        {/* ── NOTIFICATIONS ──────────────────────────────────────── */}
        {activeTab === 'notifications' && (
          <Section title="Notification Preferences" description="Choose which events send you notifications in the portal.">
            <NotifRow
              label="Low Stock Alerts"
              desc="Get notified when a product goes below the threshold."
              checked={notifs.lowStock}
              onChange={v => setNotifs(p => ({ ...p, lowStock: v }))}
            />
            <NotifRow
              label="New Sale Recorded"
              desc="Notify when a sale is successfully submitted."
              checked={notifs.newSale}
              onChange={v => setNotifs(p => ({ ...p, newSale: v }))}
            />
            <NotifRow
              label="Daily Summary"
              desc="A daily digest of sales, stock, and activity."
              checked={notifs.dailySummary}
              onChange={v => setNotifs(p => ({ ...p, dailySummary: v }))}
            />
            <NotifRow
              label="System Alerts"
              desc="Critical platform notifications and downtime alerts."
              checked={notifs.systemAlerts}
              onChange={v => setNotifs(p => ({ ...p, systemAlerts: v }))}
            />
            <div className="pt-4">
              <Button onClick={() => toast.success('Notification preferences saved')}>
                Save Preferences
              </Button>
            </div>
          </Section>
        )}

        {/* ── BILLING ────────────────────────────────────────────── */}
        {activeTab === 'billing' && (
          <>
            <Section title="Current Plan" description="Your workspace's active subscription">
              {organization ? (
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2">
                      <PlanBadge name={subscriptionSnapshot?.plan?.name || `${organization.planTier} plan`} tier={organization.planTier} />
                      <SubscriptionStatusBadge status={subscriptionSnapshot?.isLegacyUnlimited ? 'legacy' : subscriptionSnapshot?.subscription?.status || organization.status} />
                    </div>
                    {organization.planTier === 'free' && organization.billingStatus !== 'active' && organization.trialEndsAt && (() => {
                      const daysLeft = Math.ceil((new Date(organization.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                      return (
                        <p className={`text-xs mt-2 font-medium ${daysLeft <= 0 ? 'text-red-600' : daysLeft <= 3 ? 'text-amber-600' : 'text-gray-500 dark:text-gray-400'}`}>
                          {daysLeft <= 0 ? 'Your trial has ended — choose a plan below to keep going.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left in your free trial`}
                        </p>
                      );
                    })()}
                  </div>
                  {isBillingAdmin && subscriptionSnapshot?.subscription?.status === 'active' && (
                    <Button variant="outline" size="sm" disabled={cancelBusy} onClick={handleCancelSubscription} className="text-red-600 hover:text-red-700">
                      {cancelBusy ? 'Cancelling…' : 'Cancel subscription'}
                    </Button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">{billingLoading ? 'Loading…' : 'No billing information available.'}</p>
              )}
            </Section>

            {isBillingAdmin && (
              <Section title="Usage" description="Where you stand against your plan's limits">
                <UsageSummary />
                <InvoicePreview />
              </Section>
            )}

            <Section title="Available Plans" description={isBillingAdmin ? 'Upgrade your workspace at any time' : 'Contact your workspace admin to change plans'}>
              <div className="flex items-center gap-2 mb-4">
                <Button variant={billingInterval === 'monthly' ? 'default' : 'outline'} size="sm" onClick={() => setBillingInterval('monthly')}>Monthly</Button>
                <Button variant={billingInterval === 'annually' ? 'default' : 'outline'} size="sm" onClick={() => setBillingInterval('annually')}>Annual</Button>
              </div>
              {billingPlans.length > 0 ? (
                <PlanComparison
                  plans={billingPlans}
                  currency="KES"
                  interval={billingInterval}
                  currentPlanTier={organization?.planTier}
                  busyPlanId={checkoutBusyId}
                  onSelect={isBillingAdmin ? handleUpgrade : undefined}
                />
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">{billingLoading ? 'Loading…' : 'No plans are available yet.'}</p>
              )}
            </Section>
          </>
        )}

        {/* ── DOMAIN ─────────────────────────────────────────────── */}
        {activeTab === 'domain' && (
          <Section title="Custom Domain" description="Point your own domain at your workspace instead of the default subdomain">
            {!isBillingAdmin ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Contact your workspace admin to configure a custom domain.</p>
            ) : domainLoading && !domainState ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : domainState?.domain ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{domainState.domain}</p>
                    <p className={`text-xs mt-0.5 ${
                      domainState.status === 'verified' ? 'text-emerald-600' : domainState.status === 'misconfigured' ? 'text-amber-600' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {domainState.status === 'verified' ? 'Verified — this domain is live' : domainState.status === 'misconfigured' ? 'DNS not pointed correctly yet' : 'Pending DNS setup'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={domainBusy} onClick={loadDomainState}>Check status</Button>
                    <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700" disabled={domainBusy} onClick={handleRemoveDomain}>Remove</Button>
                  </div>
                </div>

                {domainState.status !== 'verified' && domainState.instructions && (
                  <div className="rounded-lg border border-[hsl(var(--border))] p-4 space-y-3 text-sm">
                    <p className="font-medium text-gray-900 dark:text-white">DNS setup</p>
                    <p className="text-gray-500 dark:text-gray-400">
                      At your domain registrar, add one of the following (subdomain like <code>shop.yourdomain.com</code> → CNAME; root domain like <code>yourdomain.com</code> → A record):
                    </p>
                    <div className="font-mono text-xs bg-gray-50 dark:bg-gray-800 rounded p-3 space-y-1">
                      <p>CNAME → {domainState.instructions.cnameTarget}</p>
                      <p>A → {domainState.instructions.aRecordTarget}</p>
                    </div>
                    {domainState.instructions.verification.length > 0 && (
                      <>
                        <p className="text-gray-500 dark:text-gray-400">Also add this TXT record to prove ownership:</p>
                        <div className="font-mono text-xs bg-gray-50 dark:bg-gray-800 rounded p-3 space-y-1">
                          {domainState.instructions.verification.map((v, i) => (
                            <p key={i}>TXT {v.domain} → {v.value}</p>
                          ))}
                        </div>
                      </>
                    )}
                    <p className="text-xs text-gray-400">DNS changes can take a few minutes to a few hours to propagate.</p>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={handleSetDomain} className="flex items-end gap-3">
                <div className="flex-1">
                  <Label htmlFor="domain">Domain</Label>
                  <Input id="domain" placeholder="shop.yourdomain.com" value={domainInput} onChange={(e) => setDomainInput(e.target.value)} disabled={domainBusy} />
                </div>
                <Button type="submit" disabled={domainBusy}>{domainBusy ? 'Adding…' : 'Add Domain'}</Button>
              </form>
            )}
          </Section>
        )}

        {/* ── INTEGRATIONS ───────────────────────────────────────── */}
        {activeTab === 'integrations' && (
          <>
          <Section title="M-Pesa" description="Connect your own Safaricom Daraja API credentials so customer payments go straight to your paybill/till">
            {!isBillingAdmin ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Contact your workspace admin to configure M-Pesa.</p>
            ) : mpesaLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
              <FeatureGate
                feature={FeatureCode.MPESA_INTEGRATION}
                requiredPlanLabel="your current plan"
                onUpgradeClick={() => { window.location.href = '/settings?tab=billing'; }}
              >
                {mpesaConfig ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-[hsl(var(--border))] p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          Shortcode {mpesaConfig.businessShortCode} · {mpesaConfig.environment}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          Configured {new Date(mpesaConfig.configuredAt).toLocaleDateString()} — credentials are encrypted and never shown again
                        </p>
                      </div>
                      <Button variant="outline" size="sm" disabled={mpesaBusy} onClick={handleRemoveMpesaConfig} className="text-red-600 hover:text-red-700">
                        {mpesaBusy ? 'Removing…' : 'Remove'}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">To change credentials, remove the current configuration and add new ones below.</p>
                  </div>
                ) : null}

                {!mpesaConfig && (
                  <form onSubmit={handleSaveMpesaConfig} className="space-y-4 max-w-lg">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Consumer Key *</Label>
                        <Input value={mpesaForm.consumerKey} onChange={(e) => setMpesaForm((f) => ({ ...f, consumerKey: e.target.value }))} required />
                      </div>
                      <div>
                        <Label>Consumer Secret *</Label>
                        <Input type="password" value={mpesaForm.consumerSecret} onChange={(e) => setMpesaForm((f) => ({ ...f, consumerSecret: e.target.value }))} required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Business Shortcode *</Label>
                        <Input value={mpesaForm.businessShortCode} onChange={(e) => setMpesaForm((f) => ({ ...f, businessShortCode: e.target.value }))} placeholder="174379" required />
                      </div>
                      <div>
                        <Label>Passkey *</Label>
                        <Input type="password" value={mpesaForm.passkey} onChange={(e) => setMpesaForm((f) => ({ ...f, passkey: e.target.value }))} required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Environment *</Label>
                        <select
                          className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                          value={mpesaForm.environment}
                          onChange={(e) => setMpesaForm((f) => ({ ...f, environment: e.target.value as 'sandbox' | 'production' }))}
                        >
                          <option value="sandbox">Sandbox</option>
                          <option value="production">Production</option>
                        </select>
                      </div>
                      <div>
                        <Label>Callback URL *</Label>
                        <Input value={mpesaForm.callbackUrl} onChange={(e) => setMpesaForm((f) => ({ ...f, callbackUrl: e.target.value }))} placeholder="https://yourshop.example.com/api/mpesa/callback" required />
                      </div>
                    </div>
                    <Button type="submit" disabled={mpesaBusy}>{mpesaBusy ? 'Saving…' : 'Save M-Pesa Credentials'}</Button>
                  </form>
                )}
              </FeatureGate>
            )}
          </Section>

          <Section title="Tax Invoicing (eTIMS)" description="Generates KRA-format invoices with a QR code on every sale — for your own records, not submitted to KRA">
            {!isBillingAdmin ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Contact your workspace admin to configure tax invoicing.</p>
            ) : kraPinLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
              <FeatureGate
                feature={FeatureCode.ETIMS_INTEGRATION}
                requiredPlanLabel="your current plan"
                onUpgradeClick={() => { window.location.href = '/settings?tab=billing'; }}
              >
                {kraPin ? (
                  <div className="rounded-lg border border-[hsl(var(--border))] p-4">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">KRA PIN: {kraPin}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      New sales now generate a tax invoice — view it from the sale&apos;s detail page.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSaveKraPin} className="flex items-end gap-3 max-w-md">
                    <div className="flex-1">
                      <Label htmlFor="kraPin">KRA PIN</Label>
                      <Input id="kraPin" placeholder="P000000000A" value={kraPinInput} onChange={(e) => setKraPinInput(e.target.value)} disabled={kraPinBusy} />
                    </div>
                    <Button type="submit" disabled={kraPinBusy}>{kraPinBusy ? 'Saving…' : 'Save'}</Button>
                  </form>
                )}
                <p className="text-xs text-gray-400 mt-3">
                  These invoices follow KRA&apos;s documented format for your own records — this is not a live submission to KRA&apos;s
                  OSCU/VSCU system, which requires separate device/software certification.
                </p>
              </FeatureGate>
            )}
          </Section>

          <Section title="QuickBooks Online" description="Sync each sale to your own QuickBooks company as a sales receipt">
            {!isBillingAdmin ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Contact your workspace admin to connect QuickBooks.</p>
            ) : qbLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : (
              <FeatureGate
                feature={FeatureCode.ACCOUNTING_INTEGRATION}
                requiredPlanLabel="your current plan"
                onUpgradeClick={() => { window.location.href = '/settings?tab=billing'; }}
              >
                {!qbStatus?.platformConfigured ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">QuickBooks isn&apos;t configured on this platform yet. Contact your platform administrator.</p>
                ) : qbStatus?.connected ? (
                  <div className="rounded-lg border border-[hsl(var(--border))] p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">Connected to QuickBooks</p>
                      {qbStatus.connectedAt && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Since {new Date(qbStatus.connectedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                    <Button variant="outline" size="sm" disabled={qbBusy} onClick={handleDisconnectQuickBooks} className="text-red-600 hover:text-red-700">
                      {qbBusy ? 'Disconnecting…' : 'Disconnect'}
                    </Button>
                  </div>
                ) : (
                  <Button disabled={qbBusy} onClick={handleConnectQuickBooks}>
                    {qbBusy ? 'Redirecting…' : 'Connect to QuickBooks'}
                  </Button>
                )}
              </FeatureGate>
            )}
          </Section>
          </>
        )}

        {/* ── ABOUT ──────────────────────────────────────────────── */}
        {activeTab === 'about' && (
          <>
            <Section title="Royal Gene Portal" description="Management portal for Royal Gene Collection shops.">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-[hsl(var(--primary)/0.06)] border border-[hsl(var(--primary)/0.15)]">
                <div className="w-14 h-14 rounded-2xl bg-[hsl(var(--primary))] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[hsl(var(--primary)/0.25)]">
                  <Store className="h-7 w-7 text-white" />
                </div>
                <div>
                  <p className="font-bold text-gray-900 dark:text-white text-lg">Royal Gene Portal</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Version 1.0.0 · Production</p>
                </div>
              </div>
            </Section>

            <Section title="System Information">
              <div className="space-y-0">
                {[
                  { label: 'Platform', value: 'Next.js 15 · Vercel' },
                  { label: 'Database', value: 'Supabase PostgreSQL' },
                  { label: 'Region', value: 'East Africa (Nairobi)' },
                  { label: 'Portal URL', value: 'portal.royalgenecollection.co.ke' },
                  { label: 'Store URL', value: 'royalgenecollection.co.ke' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-3 border-b border-[hsl(var(--border))] last:border-0">
                    <span className="text-sm text-gray-500 dark:text-gray-400">{row.label}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{row.value}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Support &amp; Links">
              {[
                { label: 'Documentation', href: '#', icon: ChevronRight },
                { label: 'Contact Support', href: 'mailto:support@royalgenecollection.co.ke', icon: Mail },
                { label: 'WhatsApp Support', href: 'https://wa.me/254726532387', icon: Phone },
              ].map(link => (
                <a
                  key={link.label}
                  href={link.href}
                  target={link.href.startsWith('http') ? '_blank' : undefined}
                  rel="noopener noreferrer"
                  className="flex items-center justify-between py-3.5 border-b border-[hsl(var(--border))] last:border-0 hover:text-[hsl(var(--primary))] transition-colors group"
                >
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 group-hover:text-[hsl(var(--primary))]">{link.label}</span>
                  <link.icon className="h-4 w-4 text-gray-400 group-hover:text-[hsl(var(--primary))]" />
                </a>
              ))}
            </Section>
          </>
        )}

      </div>
    </div>
  );
}

