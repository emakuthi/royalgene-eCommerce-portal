import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { deleteProduct } from './supabase-db';
import logger from './logger';

export interface ProductDeleteOutcome {
  /** Removed outright. */
  deleted: string[];
  /** Had sales history, so it was archived (hidden everywhere) rather than erased. */
  archived: string[];
  /** Not in the caller's organization, or already gone. */
  notFound: string[];
  /** Existed but the delete errored. */
  failed: Array<{ id: string; error: string }>;
}

/**
 * Delete products belonging to `organizationId`. Anything not in that org is
 * reported as `notFound` and never touched — the caller's ids are untrusted,
 * so ownership is checked here in one query rather than left to each route.
 * Deletion itself is the same [deleteProduct] the web portal uses (hard
 * delete, falling back to archiving when sales reference the product).
 */
export async function deleteProductsInOrg(organizationId: string, productIds: string[]): Promise<ProductDeleteOutcome> {
  const ids = [...new Set(productIds.filter((id) => typeof id === 'string' && id.length > 0))];
  const outcome: ProductDeleteOutcome = { deleted: [], archived: [], notFound: [], failed: [] };
  if (ids.length === 0) return outcome;

  const { data: owned } = await supabaseAdmin
    .from('Product')
    .select('id')
    .eq('organizationId', organizationId)
    .in('id', ids);
  const ownedIds = new Set((owned ?? []).map((r: { id: string }) => r.id));

  for (const id of ids) {
    if (!ownedIds.has(id)) {
      outcome.notFound.push(id);
      continue;
    }
    try {
      const { softDeleted } = await deleteProduct(id);
      (softDeleted ? outcome.archived : outcome.deleted).push(id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Mobile product delete failed', { productId: id, organizationId, error: message });
      outcome.failed.push({ id, error: message });
    }
  }
  return outcome;
}
