import { supabaseAdmin } from './supabase-client';
import logger from './logger';

export async function audit(opts: { actorUserId?: string; action: string; resourceType?: string; resourceId?: string; details?: unknown }) {
  try {
    const { actorUserId, action, resourceType, resourceId, details } = opts;
    await supabaseAdmin.from('audit_logs').insert([{
      actor_user_id: actorUserId || null,
      action,
      resource_type: resourceType || null,
      resource_id: resourceId || null,
      details: details || null,
    }]);
  } catch (err) {
    logger.warn('audit() failed', { err });
  }
}

