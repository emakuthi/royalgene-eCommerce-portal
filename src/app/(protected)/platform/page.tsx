'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Building2, CheckCircle2, Clock, Database, Globe, Package, PauseCircle, Plus, Receipt, RotateCcw, Settings2, ShieldCheck, Trash2, Users, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import StatCard from '@/components/ui/stat-card';
import PortalHeader from '@/components/portal/PortalHeader';
import { PortalProtected } from '@/components/portal-protected';
import { useHydratedAuth } from '@/lib/hooks';
import {
  createPlatformPlan,
  deletePlatformOrganization,
  getPlanEntitlements,
  getPlatformCapacity,
  getPlatformOrgDomain,
  getPlatformOverview,
  getPlatformSelfSignupEnabled,
  listPlatformOrganizations,
  listPlatformPlans,
  manageOrganizationSubscription,
  removePlatformOrgDomain,
  restorePlatformOrganization,
  setPlatformOrgDomain,
  setPlatformSelfSignupEnabled,
  updatePlanEntitlements,
  updatePlatformOrganization,
  updatePlatformPlan,
  type OrganizationWithCounts,
  type PlatformCapacity,
  type PlatformOverview,
  type PlanEntitlementRow,
} from '@/lib/platform';
import { DomainManager } from '@/components/domain/DomainManager';
import type { DomainState } from '@/lib/domains';
import type { Organization, PlatformPlan } from '@/lib/types';

/** Fixed id of the grandfathered default tenant — never deletable. */
const DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001';
import { FeatureCode, LimitCode, WIRED_FEATURE_CODES, WIRED_LIMIT_CODES } from '@/lib/entitlements/feature-codes';
import { FEATURE_LABELS } from '@/components/entitlements/feature-labels';

function formatKes(kobo: number): string {
  return `KES ${(kobo / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 GB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toLocaleString('en-KE', { maximumFractionDigits: 1 })} GB`;
  return `${(bytes / 1024 ** 2).toLocaleString('en-KE', { maximumFractionDigits: 1 })} MB`;
}

const LIMIT_CODE_LABELS: Record<string, string> = {
  USERS: 'team members',
  BRANCHES: 'branches/shops',
  PRODUCTS: 'products',
  MONTHLY_TRANSACTIONS: 'monthly transactions',
  STORAGE_GB: 'storage',
};

const STATUS_STYLES: Record<Organization['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending_verification: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  suspended: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const PLAN_TIERS: Organization['planTier'][] = ['free', 'starter', 'business', 'pro', 'enterprise', 'legacy'];

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] focus:ring-offset-2 disabled:opacity-50
        ${checked ? 'bg-[hsl(var(--primary))]' : 'bg-gray-200 dark:bg-gray-700'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

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

function PlatformAdminConsole() {
  const { token } = useHydratedAuth();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [capacity, setCapacity] = useState<PlatformCapacity | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationWithCounts[]>([]);
  const [selfSignupEnabled, setSelfSignupEnabledState] = useState(true);
  const [signupToggleBusy, setSignupToggleBusy] = useState(false);
  const [orgBusyId, setOrgBusyId] = useState<string | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planBusyId, setPlanBusyId] = useState<string | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [newPlan, setNewPlan] = useState({
    tier: 'starter' as PlatformPlan['tier'],
    code: '',
    name: '',
    description: '',
    monthlyPriceKes: '',
    annualPriceKes: '',
    monthlyPriceUsd: '',
    annualPriceUsd: '',
    maxShops: '',
    maxUsers: '',
  });

  // Entitlements matrix editor
  const [entitlementsPlanId, setEntitlementsPlanId] = useState<string | null>(null);
  const [entitlementRows, setEntitlementRows] = useState<PlanEntitlementRow[]>([]);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [entitlementsSaving, setEntitlementsSaving] = useState(false);

  // Manage-subscription dialog
  const [subDialogOrg, setSubDialogOrg] = useState<OrganizationWithCounts | null>(null);
  const [subAssignPlanId, setSubAssignPlanId] = useState('');
  const [subExtraDays, setSubExtraDays] = useState('14');
  const [subBusy, setSubBusy] = useState(false);

  // Manage-tenant dialog (name + custom domain + delete)
  const [manageOrg, setManageOrg] = useState<OrganizationWithCounts | null>(null);
  const [manageName, setManageName] = useState('');
  const [manageBusy, setManageBusy] = useState(false);
  const [manageDomain, setManageDomain] = useState<DomainState | null>(null);
  const [manageDomainLoading, setManageDomainLoading] = useState(false);

  // Soft-deleted tenants
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedOrgs, setDeletedOrgs] = useState<OrganizationWithCounts[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);

  // Permanent-delete confirmation
  const [purgeTarget, setPurgeTarget] = useState<OrganizationWithCounts | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState('');
  const [purgeBusy, setPurgeBusy] = useState(false);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [overviewRes, capacityRes, orgsRes, settingsRes, plansRes] = await Promise.all([
      getPlatformOverview(token),
      getPlatformCapacity(token),
      listPlatformOrganizations(token),
      getPlatformSelfSignupEnabled(token),
      listPlatformPlans(token),
    ]);
    if (overviewRes.success && overviewRes.data) setOverview(overviewRes.data);
    if (capacityRes.success && capacityRes.data) setCapacity(capacityRes.data);
    if (orgsRes.success && orgsRes.data) setOrganizations(orgsRes.data);
    if (settingsRes.success && settingsRes.data) setSelfSignupEnabledState(settingsRes.data.selfSignupEnabled);
    if (plansRes.success && plansRes.data) setPlans(plansRes.data);
    if (!overviewRes.success || !capacityRes.success || !orgsRes.success || !settingsRes.success || !plansRes.success) {
      toast.error('Failed to load some platform data');
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const toggleSelfSignup = async (next: boolean) => {
    setSignupToggleBusy(true);
    const res = await setPlatformSelfSignupEnabled(token, next);
    if (res.success) {
      setSelfSignupEnabledState(next);
      toast.success(next ? 'Self-onboarding enabled' : 'Self-onboarding disabled');
    } else {
      toast.error(res.error || 'Failed to update setting');
    }
    setSignupToggleBusy(false);
  };

  const updateOrgStatus = async (org: OrganizationWithCounts, status: Organization['status']) => {
    setOrgBusyId(org.id);
    const res = await updatePlatformOrganization(token, org.id, { status });
    if (res.success && res.data) {
      setOrganizations((prev) => prev.map((o) => (o.id === org.id ? { ...o, ...res.data } : o)));
      toast.success(`${org.name} is now ${status.replace('_', ' ')}`);
    } else {
      toast.error(res.error || 'Failed to update organization');
    }
    setOrgBusyId(null);
  };

  const updateOrgPlan = async (org: OrganizationWithCounts, planTier: Organization['planTier']) => {
    setOrgBusyId(org.id);
    const res = await updatePlatformOrganization(token, org.id, { planTier });
    if (res.success && res.data) {
      setOrganizations((prev) => prev.map((o) => (o.id === org.id ? { ...o, ...res.data } : o)));
      toast.success(`${org.name}'s plan set to ${planTier}`);
    } else {
      toast.error(res.error || 'Failed to update plan');
    }
    setOrgBusyId(null);
  };

  const togglePlanActive = async (plan: PlatformPlan) => {
    setPlanBusyId(plan.id);
    const res = await updatePlatformPlan(token, plan.id, { isActive: !plan.isActive });
    if (res.success && res.data) {
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, ...res.data } : p)));
      toast.success(`${plan.name} is now ${res.data.isActive ? 'active' : 'inactive'}`);
    } else {
      toast.error(res.error || 'Failed to update plan');
    }
    setPlanBusyId(null);
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    const monthlyPriceKobo = Math.round(parseFloat(newPlan.monthlyPriceKes) * 100);
    const annualPriceKobo = Math.round(parseFloat(newPlan.annualPriceKes) * 100);
    if (!newPlan.name || !Number.isFinite(monthlyPriceKobo) || !Number.isFinite(annualPriceKobo)) {
      toast.error('Name and both prices are required');
      return;
    }
    setCreatingPlan(true);
    const res = await createPlatformPlan(token, {
      tier: newPlan.tier,
      code: newPlan.code || undefined,
      name: newPlan.name,
      description: newPlan.description || undefined,
      monthlyPriceKobo,
      annualPriceKobo,
      monthlyPriceUSD: newPlan.monthlyPriceUsd ? Math.round(parseFloat(newPlan.monthlyPriceUsd) * 100) : null,
      annualPriceUSD: newPlan.annualPriceUsd ? Math.round(parseFloat(newPlan.annualPriceUsd) * 100) : null,
      maxShops: newPlan.maxShops ? Number(newPlan.maxShops) : null,
      maxUsers: newPlan.maxUsers ? Number(newPlan.maxUsers) : null,
    });
    if (res.success && res.data) {
      setPlans((prev) => [...prev, res.data as PlatformPlan]);
      toast.success(`Plan "${res.data.name}" created`);
      setPlanDialogOpen(false);
      setNewPlan({ tier: 'starter', code: '', name: '', description: '', monthlyPriceKes: '', annualPriceKes: '', monthlyPriceUsd: '', annualPriceUsd: '', maxShops: '', maxUsers: '' });
    } else {
      toast.error(res.error || 'Failed to create plan');
    }
    setCreatingPlan(false);
  };

  const loadEntitlements = async (planId: string) => {
    setEntitlementsPlanId(planId);
    setEntitlementsLoading(true);
    const res = await getPlanEntitlements(token, planId);
    if (res.success && res.data) setEntitlementRows(res.data);
    else toast.error(res.error || 'Failed to load entitlements');
    setEntitlementsLoading(false);
  };

  const updateEntitlementRow = (code: string, patch: Partial<Pick<PlanEntitlementRow, 'enabled' | 'limitValue'>>) => {
    setEntitlementRows((prev) => {
      const existing = prev.find((r) => r.code === code);
      if (existing) return prev.map((r) => (r.code === code ? { ...r, ...patch } : r));
      return [...prev, { id: `new-${code}`, planId: entitlementsPlanId!, code, enabled: true, limitValue: null, ...patch }];
    });
  };

  const saveEntitlements = async () => {
    if (!entitlementsPlanId) return;
    setEntitlementsSaving(true);
    const patches = entitlementRows.map((r) => ({ code: r.code, enabled: r.enabled, limitValue: r.limitValue }));
    const res = await updatePlanEntitlements(token, entitlementsPlanId, patches);
    if (res.success && res.data) {
      setEntitlementRows(res.data);
      toast.success('Entitlements saved');
    } else {
      toast.error(res.error || 'Failed to save entitlements');
    }
    setEntitlementsSaving(false);
  };

  const runSubscriptionAction = async (action: 'assignPlan' | 'extendTrial' | 'suspend' | 'reactivate') => {
    if (!subDialogOrg) return;
    setSubBusy(true);
    const res = await manageOrganizationSubscription(
      token,
      subDialogOrg.id,
      action === 'assignPlan'
        ? { action, planId: subAssignPlanId }
        : action === 'extendTrial'
          ? { action, extraDays: Number(subExtraDays) || 14 }
          : { action },
    );
    if (res.success) {
      toast.success('Subscription updated');
      void loadAll();
      setSubDialogOrg(null);
    } else {
      toast.error(res.error || 'Failed to update subscription');
    }
    setSubBusy(false);
  };

  // ── Manage-tenant dialog ────────────────────────────────────────────────
  const openManage = (org: OrganizationWithCounts) => {
    setManageOrg(org);
    setManageName(org.name);
    setManageDomain(null);
    setManageDomainLoading(true);
    getPlatformOrgDomain(token, org.id).then((res) => {
      if (res.success && res.data) setManageDomain(res.data);
      setManageDomainLoading(false);
    });
  };

  const applyOrgUpdate = (updated: Organization) => {
    setOrganizations((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
    setManageOrg((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
  };

  const saveManageName = async () => {
    if (!manageOrg || manageName.trim() === manageOrg.name) return;
    setManageBusy(true);
    const res = await updatePlatformOrganization(token, manageOrg.id, { name: manageName.trim() });
    if (res.success && res.data) {
      applyOrgUpdate(res.data);
      toast.success('Name updated');
    } else {
      toast.error(res.error || 'Failed to update name');
    }
    setManageBusy(false);
  };

  const refreshManageDomain = async () => {
    if (!manageOrg) return;
    setManageBusy(true);
    const res = await getPlatformOrgDomain(token, manageOrg.id);
    if (res.success && res.data) {
      setManageDomain(res.data);
      applyOrgUpdate({ ...manageOrg, customDomain: res.data.domain, customDomainStatus: res.data.status } as Organization);
    } else {
      toast.error(res.error || 'Failed to check domain');
    }
    setManageBusy(false);
  };

  const addManageDomain = async (domain: string) => {
    if (!manageOrg) return;
    setManageBusy(true);
    const res = await setPlatformOrgDomain(token, manageOrg.id, domain);
    if (res.success && res.data) {
      setManageDomain(res.data);
      applyOrgUpdate({ ...manageOrg, customDomain: res.data.domain, customDomainStatus: res.data.status } as Organization);
      toast.success('Domain added — share the DNS records below with the tenant');
    } else {
      toast.error(res.error || 'Failed to add domain');
    }
    setManageBusy(false);
  };

  const removeManageDomain = async () => {
    if (!manageOrg) return;
    setManageBusy(true);
    const res = await removePlatformOrgDomain(token, manageOrg.id);
    if (res.success) {
      setManageDomain({ domain: null, status: null, instructions: null });
      applyOrgUpdate({ ...manageOrg, customDomain: null, customDomainStatus: null } as Organization);
      toast.success('Domain removed');
    } else {
      toast.error(res.error || 'Failed to remove domain');
    }
    setManageBusy(false);
  };

  // ── Soft-delete / restore / purge ──────────────────────────────────────
  const loadDeleted = useCallback(async () => {
    if (!token) return;
    setDeletedLoading(true);
    const res = await listPlatformOrganizations(token, { includeDeleted: true });
    if (res.success && res.data) setDeletedOrgs(res.data.filter((o) => o.deletedAt));
    setDeletedLoading(false);
  }, [token]);

  useEffect(() => {
    if (showDeleted) void loadDeleted();
  }, [showDeleted, loadDeleted]);

  const softDeleteOrg = async (org: OrganizationWithCounts) => {
    setOrgBusyId(org.id);
    const res = await deletePlatformOrganization(token, org.id);
    if (res.success) {
      setOrganizations((prev) => prev.filter((o) => o.id !== org.id));
      setManageOrg((prev) => (prev?.id === org.id ? null : prev));
      toast.success(`${org.name} deleted — recoverable from "Show deleted"`);
      void loadAll();
      if (showDeleted) void loadDeleted();
    } else {
      toast.error(res.error || 'Failed to delete tenant');
    }
    setOrgBusyId(null);
  };

  const restoreOrg = async (org: OrganizationWithCounts) => {
    setOrgBusyId(org.id);
    const res = await restorePlatformOrganization(token, org.id);
    if (res.success) {
      toast.success(`${org.name} restored`);
      void loadAll();
      void loadDeleted();
    } else {
      toast.error(res.error || 'Failed to restore tenant');
    }
    setOrgBusyId(null);
  };

  const confirmPurge = async () => {
    if (!purgeTarget) return;
    setPurgeBusy(true);
    const res = await deletePlatformOrganization(token, purgeTarget.id, { purge: true, confirm: purgeConfirm.trim() });
    if (res.success) {
      toast.success(`${purgeTarget.name} permanently deleted`);
      setDeletedOrgs((prev) => prev.filter((o) => o.id !== purgeTarget.id));
      setPurgeTarget(null);
      setPurgeConfirm('');
    } else {
      toast.error(res.error || 'Purge failed');
    }
    setPurgeBusy(false);
  };

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost:3001';

  return (
    <div className="w-full">
      <PortalHeader
        backHref="/dashboard"
        title="Platform Admin"
        description="Cross-tenant overview: manage organizations, plans, and self-onboarding"
        breadcrumbs={[{ label: 'Portal', href: '/dashboard' }, { label: 'Platform' }]}
      />

      <div className="px-4 sm:px-6 py-6 space-y-6 w-full">
        {/* Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard title="Organizations" value={loading ? '-' : overview?.totalOrganizations ?? 0} icon={<Building2 className="h-8 w-8 text-pink-700" />} />
          <StatCard title="Active" value={loading ? '-' : overview?.organizationsByStatus.active ?? 0} icon={<CheckCircle2 className="h-8 w-8 text-emerald-600" />} />
          <StatCard title="Pending Verification" value={loading ? '-' : overview?.organizationsByStatus.pending_verification ?? 0} icon={<Clock className="h-8 w-8 text-amber-500" />} />
          <StatCard title="Suspended" value={loading ? '-' : overview?.organizationsByStatus.suspended ?? 0} icon={<PauseCircle className="h-8 w-8 text-red-600" />} />
          <StatCard title="Total Users" value={loading ? '-' : overview?.totalUsers ?? 0} icon={<Users className="h-8 w-8 text-sky-600" />} />
          <StatCard title="Total Shops" value={loading ? '-' : overview?.totalShops ?? 0} icon={<ShieldCheck className="h-8 w-8 text-violet-600" />} />
        </div>

        {/* Capacity — application-metered cross-tenant usage */}
        <Section
          title="Capacity"
          description="Application-metered usage across every tenant. Supabase infrastructure-level metrics (database/disk usage, connection pool, etc.) require Management API access this app doesn't have configured, so they're intentionally not shown here rather than guessed."
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <StatCard title="Total Products" value={loading ? '-' : capacity?.totalProducts ?? 0} icon={<Package className="h-8 w-8 text-indigo-600" />} />
            <StatCard title="Transactions This Month" value={loading ? '-' : (capacity?.monthlyTransactions ?? 0).toLocaleString()} icon={<Receipt className="h-8 w-8 text-teal-600" />} />
            <StatCard title="Total Storage Used" value={loading ? '-' : formatBytes(capacity?.totalStorageBytes ?? 0)} icon={<Database className="h-8 w-8 text-orange-600" />} />
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Tenants nearing a plan limit this month
            </h3>
            {loading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
            ) : !capacity?.tenantsNearingLimit.length ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No tenant has crossed a usage threshold this month.</p>
            ) : (
              <div className="space-y-2">
                {capacity.tenantsNearingLimit.map((t, i) => (
                  <div
                    key={`${t.organizationId}-${t.limitCode}-${i}`}
                    className="flex items-center justify-between text-sm px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800"
                  >
                    <span className="text-gray-900 dark:text-white font-medium">{t.organizationName}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {LIMIT_CODE_LABELS[t.limitCode] ?? t.limitCode}
                    </span>
                    <Badge
                      className={`text-xs px-2 py-0.5 ${
                        t.threshold >= 100
                          ? 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                          : t.threshold >= 90
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                            : 'bg-sky-50 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
                      }`}
                    >
                      {t.threshold}%
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* Self-onboarding toggle */}
        <Section title="Self-Onboarding" description="Whether new customers can create their own workspace at /signup without your involvement">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">
                {selfSignupEnabled ? 'Self-service signup is enabled' : 'Self-service signup is disabled'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {selfSignupEnabled
                  ? 'Anyone can create a new organization from the /signup page.'
                  : 'The /signup page will show a closed message and new signups will be rejected.'}
              </p>
            </div>
            <Toggle checked={selfSignupEnabled} onChange={toggleSelfSignup} disabled={signupToggleBusy || loading} />
          </div>
        </Section>

        {/* Organizations */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Organizations</CardTitle>
              <label className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 cursor-pointer">
                Show deleted
                <Toggle checked={showDeleted} onChange={setShowDeleted} />
              </label>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-500 dark:text-gray-400 border-b border-[hsl(var(--border))]">
                    <th className="py-3">Organization</th>
                    <th className="py-3">Status</th>
                    <th className="py-3">Plan</th>
                    <th className="py-3">Users</th>
                    <th className="py-3">Shops</th>
                    <th className="py-3">Created</th>
                    <th className="py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((org) => (
                    <tr key={org.id} className="border-b border-[hsl(var(--border))]">
                      <td className="py-4">
                        <div className="font-medium text-gray-900 dark:text-white">{org.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{org.slug}.{rootDomain}</div>
                        {org.customDomain && (
                          <div className="text-xs mt-0.5 flex items-center gap-1 text-gray-500 dark:text-gray-400">
                            <Globe className="h-3 w-3" />
                            {org.customDomain}
                            <span className={
                              org.customDomainStatus === 'verified' ? 'text-emerald-600'
                                : org.customDomainStatus === 'misconfigured' ? 'text-amber-600'
                                : 'text-gray-400'
                            }>
                              ({org.customDomainStatus ?? 'pending'})
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-4">
                        <Badge className={`text-xs px-2 py-0.5 ${STATUS_STYLES[org.status]}`}>
                          {org.status.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-4">
                        <select
                          value={org.planTier}
                          disabled={orgBusyId === org.id}
                          onChange={(e) => updateOrgPlan(org, e.target.value as Organization['planTier'])}
                          className="rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-1 text-sm"
                        >
                          {PLAN_TIERS.map((tier) => (
                            <option key={tier} value={tier}>{tier}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-4 text-gray-600 dark:text-gray-300">{org.userCount}</td>
                      <td className="py-4 text-gray-600 dark:text-gray-300">{org.shopCount}</td>
                      <td className="py-4 text-gray-500 dark:text-gray-400 text-sm">
                        {new Date(org.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {org.status === 'suspended' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={orgBusyId === org.id}
                              onClick={() => updateOrgStatus(org, 'active')}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" /> Activate
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700"
                              disabled={orgBusyId === org.id || org.status === 'cancelled'}
                              onClick={() => updateOrgStatus(org, 'suspended')}
                            >
                              <XCircle className="h-4 w-4 mr-1" /> Suspend
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setSubDialogOrg(org); setSubAssignPlanId(''); setSubExtraDays('14'); }}
                          >
                            Subscription
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => openManage(org)}>
                            <Settings2 className="h-4 w-4 mr-1" /> Manage
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && organizations.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                        No organizations yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {showDeleted && (
              <div className="mt-6 border-t border-[hsl(var(--border))] pt-4">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Deleted tenants</h3>
                {deletedLoading ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
                ) : deletedOrgs.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">No deleted tenants.</p>
                ) : (
                  <div className="space-y-2">
                    {deletedOrgs.map((org) => (
                      <div key={org.id} className="flex items-center justify-between gap-3 text-sm px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800">
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">{org.name}</span>
                          <span className="text-gray-500 dark:text-gray-400 ml-2">{org.slug}</span>
                          {org.deletedAt && (
                            <span className="text-gray-400 ml-2">deleted {new Date(org.deletedAt).toLocaleDateString()}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button size="sm" variant="outline" disabled={orgBusyId === org.id} onClick={() => restoreOrg(org)}>
                            <RotateCcw className="h-4 w-4 mr-1" /> Restore
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => { setPurgeTarget(org); setPurgeConfirm(''); }}
                          >
                            <Trash2 className="h-4 w-4 mr-1" /> Delete permanently
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Plans */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Plans</CardTitle>
            <Button size="sm" onClick={() => setPlanDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Plan
            </Button>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-500 dark:text-gray-400 border-b border-[hsl(var(--border))]">
                    <th className="py-3">Plan</th>
                    <th className="py-3">Tier</th>
                    <th className="py-3">Monthly</th>
                    <th className="py-3">Annual</th>
                    <th className="py-3">Paystack</th>
                    <th className="py-3">Status</th>
                    <th className="py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plans.map((plan) => (
                    <tr key={plan.id} className="border-b border-[hsl(var(--border))]">
                      <td className="py-4">
                        <div className="font-medium text-gray-900 dark:text-white">{plan.name}</div>
                        {plan.description && <div className="text-xs text-gray-500 dark:text-gray-400">{plan.description}</div>}
                      </td>
                      <td className="py-4 text-gray-600 dark:text-gray-300">{plan.tier}</td>
                      <td className="py-4 text-gray-600 dark:text-gray-300">{formatKes(plan.monthlyPriceKobo)}</td>
                      <td className="py-4 text-gray-600 dark:text-gray-300">{formatKes(plan.annualPriceKobo)}</td>
                      <td className="py-4">
                        {plan.paystackMonthlyPlanCode && plan.paystackAnnualPlanCode ? (
                          <Badge className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">synced</Badge>
                        ) : (
                          <Badge className="text-xs px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">not configured</Badge>
                        )}
                      </td>
                      <td className="py-4">
                        <Badge className={`text-xs px-2 py-0.5 ${plan.isActive ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
                          {plan.isActive ? 'active' : 'inactive'}
                        </Badge>
                      </td>
                      <td className="py-4">
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={planBusyId === plan.id}
                            onClick={() => togglePlanActive(plan)}
                          >
                            {plan.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => loadEntitlements(plan.id)}>
                            Entitlements
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!loading && plans.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                        No plans yet — create one to let tenants subscribe.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Entitlements matrix editor for the plan selected above */}
        {entitlementsPlanId && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Entitlements — {plans.find((p) => p.id === entitlementsPlanId)?.name}</CardTitle>
              <Button size="sm" disabled={entitlementsSaving || entitlementsLoading} onClick={saveEntitlements}>
                {entitlementsSaving ? 'Saving…' : 'Save changes'}
              </Button>
            </CardHeader>
            <CardContent>
              {entitlementsLoading ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>
              ) : (
                <div className="space-y-6">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Features</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {Object.values(FeatureCode).map((code) => {
                        const row = entitlementRows.find((r) => r.code === code);
                        const enabled = row?.enabled ?? false;
                        const isWired = (WIRED_FEATURE_CODES as readonly string[]).includes(code);
                        return (
                          <label key={code} className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => updateEntitlementRow(code, { enabled: e.target.checked })}
                              className="rounded border-[hsl(var(--border))]"
                            />
                            <span className="text-gray-700 dark:text-gray-300">
                              {FEATURE_LABELS[code] || code}
                              {!isWired && <span className="text-gray-400"> (not yet built)</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white mb-2">Limits</p>
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {Object.values(LimitCode).map((code) => {
                        const row = entitlementRows.find((r) => r.code === code);
                        const isWired = (WIRED_LIMIT_CODES as readonly string[]).includes(code);
                        return (
                          <div key={code}>
                            <Label className="text-xs">
                              {code.replace(/_/g, ' ')}
                              {!isWired && <span className="text-gray-400"> (not enforced)</span>}
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              placeholder="Unlimited"
                              value={row?.limitValue ?? ''}
                              onChange={(e) => updateEntitlementRow(code, { limitValue: e.target.value ? Number(e.target.value) : null })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create Plan Dialog */}
      <Dialog open={planDialogOpen} onOpenChange={setPlanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Plan</DialogTitle>
            <DialogDescription>Prices are in KES. Paystack plan codes are minted automatically if billing is configured.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreatePlan} className="space-y-4 mt-1">
            <div>
              <Label>Plan Name *</Label>
              <Input value={newPlan.name} onChange={(e) => setNewPlan((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Pro" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tier *</Label>
                <select
                  className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                  value={newPlan.tier}
                  onChange={(e) => setNewPlan((p) => ({ ...p, tier: e.target.value as PlatformPlan['tier'] }))}
                >
                  <option value="starter">Starter</option>
                  <option value="business">Business</option>
                  <option value="pro">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <Label>Code</Label>
                <Input value={newPlan.code} onChange={(e) => setNewPlan((p) => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="e.g. PROFESSIONAL" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={newPlan.description} onChange={(e) => setNewPlan((p) => ({ ...p, description: e.target.value }))} placeholder="Optional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Monthly Price (KES) *</Label>
                <Input type="number" min="0" step="0.01" value={newPlan.monthlyPriceKes} onChange={(e) => setNewPlan((p) => ({ ...p, monthlyPriceKes: e.target.value }))} placeholder="1500" />
              </div>
              <div>
                <Label>Annual Price (KES) *</Label>
                <Input type="number" min="0" step="0.01" value={newPlan.annualPriceKes} onChange={(e) => setNewPlan((p) => ({ ...p, annualPriceKes: e.target.value }))} placeholder="15000" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Monthly Price (USD, display-only)</Label>
                <Input type="number" min="0" step="0.01" value={newPlan.monthlyPriceUsd} onChange={(e) => setNewPlan((p) => ({ ...p, monthlyPriceUsd: e.target.value }))} placeholder="12" />
              </div>
              <div>
                <Label>Annual Price (USD, display-only)</Label>
                <Input type="number" min="0" step="0.01" value={newPlan.annualPriceUsd} onChange={(e) => setNewPlan((p) => ({ ...p, annualPriceUsd: e.target.value }))} placeholder="120" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Max Shops</Label>
                <Input type="number" min="0" value={newPlan.maxShops} onChange={(e) => setNewPlan((p) => ({ ...p, maxShops: e.target.value }))} placeholder="Unlimited" />
              </div>
              <div>
                <Label>Max Users</Label>
                <Input type="number" min="0" value={newPlan.maxUsers} onChange={(e) => setNewPlan((p) => ({ ...p, maxUsers: e.target.value }))} placeholder="Unlimited" />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <Button type="submit" className="flex-1" disabled={creatingPlan}>{creatingPlan ? 'Creating...' : 'Create Plan'}</Button>
              <Button variant="outline" type="button" onClick={() => setPlanDialogOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Manage Subscription Dialog */}
      <Dialog open={Boolean(subDialogOrg)} onOpenChange={(open) => !open && setSubDialogOrg(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage subscription — {subDialogOrg?.name}</DialogTitle>
            <DialogDescription>Full subscription lifecycle control. Assigning a plan or reactivating sets the subscription to active immediately.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 mt-1">
            <div>
              <Label>Assign plan</Label>
              <div className="flex gap-2 mt-1">
                <select
                  className="flex-1 rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                  value={subAssignPlanId}
                  onChange={(e) => setSubAssignPlanId(e.target.value)}
                >
                  <option value="">Select a plan…</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <Button size="sm" disabled={!subAssignPlanId || subBusy} onClick={() => runSubscriptionAction('assignPlan')}>
                  Assign
                </Button>
              </div>
            </div>
            <div>
              <Label>Extend trial</Label>
              <div className="flex gap-2 mt-1">
                <Input type="number" min="1" value={subExtraDays} onChange={(e) => setSubExtraDays(e.target.value)} className="flex-1" />
                <Button size="sm" variant="outline" disabled={subBusy} onClick={() => runSubscriptionAction('extendTrial')}>
                  Add days
                </Button>
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" disabled={subBusy} onClick={() => runSubscriptionAction('suspend')}>
                Suspend subscription
              </Button>
              <Button variant="outline" className="flex-1" disabled={subBusy} onClick={() => runSubscriptionAction('reactivate')}>
                Reactivate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Tenant Dialog */}
      <Dialog open={Boolean(manageOrg)} onOpenChange={(open) => !open && setManageOrg(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Manage tenant — {manageOrg?.name}</DialogTitle>
            <DialogDescription>
              {manageOrg?.slug}.{rootDomain}
            </DialogDescription>
          </DialogHeader>

          {manageOrg && (
            <div className="space-y-6 mt-1">
              {/* Display name */}
              <div>
                <Label htmlFor="manage-name">Display name</Label>
                <div className="flex gap-2 mt-1">
                  <Input
                    id="manage-name"
                    value={manageName}
                    onChange={(e) => setManageName(e.target.value)}
                    disabled={manageBusy}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    disabled={manageBusy || manageName.trim() === manageOrg.name || manageName.trim().length < 2}
                    onClick={saveManageName}
                  >
                    Save
                  </Button>
                </div>
              </div>

              {/* Custom domain */}
              <div>
                <Label>Custom domain</Label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-2">
                  Serve this tenant on their own domain (e.g. <code>abcd.theirdomain.com</code>) instead of the
                  default subdomain. Only routes once DNS is verified.
                </p>
                <DomainManager
                  state={manageDomain}
                  loading={manageDomainLoading}
                  busy={manageBusy}
                  placeholder="abcd.theirdomain.com"
                  onAdd={addManageDomain}
                  onRefresh={refreshManageDomain}
                  onRemove={removeManageDomain}
                />
              </div>

              {/* Danger zone */}
              {manageOrg.id !== DEFAULT_ORGANIZATION_ID && (
                <div className="rounded-lg border border-red-200 dark:border-red-900/50 p-4">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">Delete tenant</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-3">
                    Marks the workspace deleted, blocks all logins and releases its domain. Recoverable from
                    &ldquo;Show deleted&rdquo;. Permanent deletion is a separate step.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-600 hover:text-red-700"
                    disabled={orgBusyId === manageOrg.id}
                    onClick={() => softDeleteOrg(manageOrg)}
                  >
                    <Trash2 className="h-4 w-4 mr-1" /> Delete tenant
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Permanent-delete confirmation */}
      <Dialog open={Boolean(purgeTarget)} onOpenChange={(open) => !open && setPurgeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permanently delete {purgeTarget?.name}?</DialogTitle>
            <DialogDescription>
              This erases every shop, product, sale, user and record for this tenant. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <Label htmlFor="purge-confirm">
              Type <span className="font-mono font-semibold">{purgeTarget?.slug}</span> to confirm
            </Label>
            <Input
              id="purge-confirm"
              value={purgeConfirm}
              onChange={(e) => setPurgeConfirm(e.target.value)}
              disabled={purgeBusy}
              autoComplete="off"
            />
            <div className="flex gap-3 pt-1">
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                disabled={purgeBusy || purgeConfirm.trim() !== purgeTarget?.slug}
                onClick={confirmPurge}
              >
                {purgeBusy ? 'Deleting…' : 'Permanently delete'}
              </Button>
              <Button variant="outline" type="button" onClick={() => setPurgeTarget(null)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PlatformAdminPage() {
  return (
    <PortalProtected requiredRole="super_admin" pageName="Platform Admin">
      <PlatformAdminConsole />
    </PortalProtected>
  );
}
