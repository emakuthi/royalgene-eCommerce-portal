import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import logger from '../logger';

/**
 * Insert a row whose primary key `id` is supplied by the caller (a
 * client-generated UUID for an offline-created record). If a row with that id
 * already exists — the client is retrying a request whose response it never
 * got — this returns the existing row with `created: false` instead of
 * erroring, so the caller can skip every side effect (stock decrement, tax
 * invoice, …) it would otherwise run.
 *
 * The insert-then-catch-23505 pattern is atomic; a naive SELECT-then-INSERT
 * would race two concurrent retries into two rows.
 */
export async function idempotentInsert<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown> & { id: string },
): Promise<
  | { ok: true; created: boolean; row: T }
  | { ok: false; error: string; code?: string }
> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .insert([row])
    .select('*')
    .single();

  if (!error && data) {
    return { ok: true, created: true, row: data as T };
  }

  // 23505 = unique_violation. Could be the PK (a genuine retry) or another
  // unique constraint (a real conflict). Only treat a PK hit as idempotent.
  if (error?.code === '23505') {
    const { data: existing } = await supabaseAdmin
      .from(table)
      .select('*')
      .eq('id', row.id)
      .maybeSingle();
    if (existing) {
      logger.info('[sync] idempotent replay', { table, id: row.id });
      return { ok: true, created: false, row: existing as T };
    }
    return { ok: false, error: error.message, code: error.code };
  }

  logger.error('[sync] idempotentInsert failed', { table, id: row.id, error: error?.message });
  return { ok: false, error: error?.message ?? 'Insert failed', code: error?.code };
}
