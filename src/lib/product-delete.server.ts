import 'server-only';
import { supabaseAdmin } from './supabase-client';
import { deleteProduct } from './supabase-db';
import { trackFromRequest } from './activity-tracker';
import logger from './logger';
import type { NextRequest } from 'next/server';

export const PRODUCT_DELETED_MESSAGE =
  'Product deleted. A workspace admin can bring it back with its stock and history from Deleted Products on the web portal.';

export interface ProductDeleteOutcome {
  /** Always empty now, because nothing is erased. Kept so app versions already installed can still read this. */
  deleted: string[];
  /** Hidden everywhere and restorable. */
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
 * Deletion itself is the same [deleteProduct] the web portal uses.
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

/** One Activity row per product, with its name and SKU kept because a later search has only these to go on. */
export async function logProductDeletes(
  request: NextRequest,
  payload: Parameters<typeof trackFromRequest>[1],
  outcome: ProductDeleteOutcome,
): Promise<void> {
  const ids = [...outcome.deleted, ...outcome.archived];
  if (ids.length === 0) return;
  const { data } = await supabaseAdmin.from('Product').select('id, name, sku').in('id', ids);
  const products = new Map((data ?? []).map((p: { id: string; name: string; sku: string | null }) => [p.id, p]));
  await Promise.all(ids.map((id) => trackFromRequest(request, payload, {
    action: 'product.delete',
    category: 'product',
    resourceType: 'product',
    resourceId: id,
    details: { name: products.get(id)?.name ?? null, sku: products.get(id)?.sku ?? null },
  })));
}
