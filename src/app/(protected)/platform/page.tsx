'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Building2, CheckCircle2, Clock, PauseCircle, Plus, ShieldCheck, Users, XCircle } from 'lucide-react';
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
  getPlatformOverview,
  getPlatformSelfSignupEnabled,
  listPlatformOrganizations,
  listPlatformPlans,
  setPlatformSelfSignupEnabled,
  updatePlatformOrganization,
  updatePlatformPlan,
  type OrganizationWithCounts,
  type PlatformOverview,
} from '@/lib/platform';
import type { Organization, PlatformPlan } from '@/lib/types';

function formatKes(kobo: number): string {
  return `KES ${(kobo / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLES: Record<Organization['status'], string> = {
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending_verification: 'bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  suspended: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const PLAN_TIERS: Organization['planTier'][] = ['free', 'starter', 'pro', 'enterprise', 'legacy'];

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
    name: '',
    description: '',
    monthlyPriceKes: '',
    annualPriceKes: '',
    maxShops: '',
    maxUsers: '',
  });

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [overviewRes, orgsRes, settingsRes, plansRes] = await Promise.all([
      getPlatformOverview(token),
      listPlatformOrganizations(token),
      getPlatformSelfSignupEnabled(token),
      listPlatformPlans(token),
    ]);
    if (overviewRes.success && overviewRes.data) setOverview(overviewRes.data);
    if (orgsRes.success && orgsRes.data) setOrganizations(orgsRes.data);
    if (settingsRes.success && settingsRes.data) setSelfSignupEnabledState(settingsRes.data.selfSignupEnabled);
    if (plansRes.success && plansRes.data) setPlans(plansRes.data);
    if (!overviewRes.success || !orgsRes.success || !settingsRes.success || !plansRes.success) {
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
      name: newPlan.name,
      description: newPlan.description || undefined,
      monthlyPriceKobo,
      annualPriceKobo,
      maxShops: newPlan.maxShops ? Number(newPlan.maxShops) : null,
      maxUsers: newPlan.maxUsers ? Number(newPlan.maxUsers) : null,
    });
    if (res.success && res.data) {
      setPlans((prev) => [...prev, res.data as PlatformPlan]);
      toast.success(`Plan "${res.data.name}" created`);
      setPlanDialogOpen(false);
      setNewPlan({ tier: 'starter', name: '', description: '', monthlyPriceKes: '', annualPriceKes: '', maxShops: '', maxUsers: '' });
    } else {
      toast.error(res.error || 'Failed to create plan');
    }
    setCreatingPlan(false);
  };

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
            <CardTitle>Organizations</CardTitle>
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
                        <div className="text-xs text-gray-500 dark:text-gray-400">{org.slug}.{process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost:3001'}</div>
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
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={planBusyId === plan.id}
                          onClick={() => togglePlanActive(plan)}
                        >
                          {plan.isActive ? 'Deactivate' : 'Activate'}
                        </Button>
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
            <div>
              <Label>Tier *</Label>
              <select
                className="w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm"
                value={newPlan.tier}
                onChange={(e) => setNewPlan((p) => ({ ...p, tier: e.target.value as PlatformPlan['tier'] }))}
              >
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
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
