import { supabaseAdmin } from '@/lib/supabase-client';
import { jsonResponse } from '@/lib/apiResponse';
import logger from '@/lib/logger';

export const DEACTIVATED_MESSAGE = 'This account has been deactivated. Contact your administrator.';

/** Someone can hold several shop rows, so they're only deactivated once none of them is active. */
export function allRowsDeactivated(rows: Array<{ isActive?: boolean | null }> | null | undefined): boolean {
  return !!rows && rows.length > 0 && rows.every((row) => row.isActive === false);
}

/**
 * Whether the admin has deactivated this person. Workspace admins are exempt, so an owner's own row can
 * never lock them out of their business. A failed lookup counts as not deactivated, because a database
 * blip mustn't sign a whole team out.
 */
export async function isDeactivatedStaff(user: { userId: string; role?: string | null }): Promise<boolean> {
  if (user.role === 'admin' || user.role === 'super_admin') return false;
  try {
    const { data, error } = await supabaseAdmin.from('PortalUser').select('isActive').eq('userId', user.userId);
    if (error) {
      logger.warn('Deactivated staff check failed', { userId: user.userId, error: error.message });
      return false;
    }
    return allRowsDeactivated(data as Array<{ isActive?: boolean | null }> | null);
  } catch (error) {
    logger.warn('Deactivated staff check failed', { userId: user.userId, error: String(error) });
    return false;
  }
}

/**
 * A 401 makes the app try to renew its token, the renewal is refused too, and the app goes back to sign-in.
 * Unsent sales aren't touched: both apps keep their queue on a 401 and never reverse a sale for it.
 */
export async function rejectIfDeactivated(user: { userId: string; role?: string | null }): Promise<Response | null> {
  if (!(await isDeactivatedStaff(user))) return null;
  return jsonResponse({ success: false, error: DEACTIVATED_MESSAGE, code: 'ACCOUNT_DEACTIVATED' }, 401);
}
