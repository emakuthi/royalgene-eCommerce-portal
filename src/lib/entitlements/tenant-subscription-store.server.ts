import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import type { Organization, TenantSubscription } from '../types';

/**
 * Leaf module: pure TenantSubscription/Organization writes, no dependency on
 * billing.server.ts's audit logging. Both subscription-status.server.ts
 * (admin-driven transitions) and billing.server.ts's applySuccessfulSubscription
 * (payment-driven transitions) write through here — keeping this dependency-free
 * avoids a circular import between the two.
 */

export async function getSubscriptionRow(organizationId: string): Promise<TenantSubscription | null> {
  const { data } = await supabaseAdmin.from('TenantSubscription').select('*').eq('organizationId', organizationId).maybeSingle();
  return (data as TenantSubscription | null) ?? null;
}

export async function upsertTenantSubscription(
  organizationId: string,
  patch: Partial<Omit<TenantSubscription, 'id' | 'organizationId' | 'createdAt'>>,
): Promise<TenantSubscription> {
  const existing = await getSubscriptionRow(organizationId);
  const now = new Date().toISOString();

  if (!existing) {
    const { data, error } = await supabaseAdmin
      .from('TenantSubscription')
      .insert([{ organizationId, status: 'trialing', ...patch, createdAt: now, updatedAt: now }])
      .select('*')
      .single();
    if (error || !data) throw new Error(error?.message || 'Failed to create subscription');
    return data as TenantSubscription;
  }

  const { data, error } = await supabaseAdmin
    .from('TenantSubscription')
    .update({ ...patch, updatedAt: now })
    .eq('organizationId', organizationId)
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'Failed to update subscription');
  return data as TenantSubscription;
}

export async function syncOrganizationBilling(
  organizationId: string,
  patch: Partial<Pick<Organization, 'planTier' | 'billingStatus' | 'trialEndsAt'>>,
): Promise<void> {
  await supabaseAdmin
    .from('Organization')
    .update({ ...patch, updatedAt: new Date().toISOString() })
    .eq('id', organizationId);
}
