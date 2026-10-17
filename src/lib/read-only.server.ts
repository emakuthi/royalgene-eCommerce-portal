import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { readOnlyReason, READ_ONLY_MESSAGES, type ReadOnlyReason } from './tenant';

export interface ReadOnlyState {
  reason: ReadOnlyReason;
  message: string;
}

/**
 * Whether a workspace is read-only right now, and why — the same rule the
 * middleware enforces, for the website banner and the app. Null = full use.
 */
export async function getReadOnlyState(organizationId: string | null | undefined): Promise<ReadOnlyState | null> {
  if (!organizationId) return null;
  let { data, error } = await supabaseAdmin
    .from('Organization')
    .select('planTier, trialEndsAt, billingStatus, paidThrough')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) {
    // paidThrough not migrated yet (20261017_01).
    ({ data, error } = await supabaseAdmin
      .from('Organization')
      .select('planTier, trialEndsAt, billingStatus')
      .eq('id', organizationId)
      .maybeSingle());
  }
  if (error || !data) return null;
  const reason = readOnlyReason(data as Parameters<typeof readOnlyReason>[0]);
  return reason ? { reason, message: READ_ONLY_MESSAGES[reason] } : null;
}
