import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import logger from '../logger';
import { hasFeature } from '../entitlements/entitlement-service.server';
import { FeatureCode } from '../entitlements/feature-codes';
import { getValidAccessToken } from '../integrations/quickbooks-connection.server';
import { addLineToSalesReceipt, createSalesReceipt, findOrCreateItem } from './quickbooks.server';

/**
 * Fire-and-forget, called from the sale-creation routes — a sale must never
 * fail because QuickBooks sync had a problem. One SalesReceipt per checkout:
 * a line sharing a saleGroupId with an already-synced line is added to that
 * line's receipt instead of getting its own. No chart-of-accounts mapping, no
 * historical backfill. Every attempt
 * is logged to AccountingSyncLog (synced/failed/skipped) so failures are
 * visible rather than silent.
 */
export async function syncSaleToQuickBooks(saleId: string): Promise<void> {
  const provider = 'quickbooks';
  try {
    const { data: sale } = await supabaseAdmin.from('SalesEntry').select('*').eq('id', saleId).maybeSingle();
    if (!sale) return;

    const organizationId = sale.organizationId as string;
    if (!organizationId) return;

    const enabled = await hasFeature(organizationId, FeatureCode.ACCOUNTING_INTEGRATION);
    if (!enabled) return;

    const connection = await getValidAccessToken(organizationId);
    if (!connection) return; // Not connected — nothing to sync, not an error.

    const { data: product } = await supabaseAdmin.from('Product').select('name, sku').eq('id', sale.productId).maybeSingle();
    if (!product) {
      await logSync(organizationId, saleId, provider, 'failed', null, 'Product not found');
      return;
    }

    const itemResult = await findOrCreateItem(connection.realmId, connection.accessToken, { sku: product.sku as string, name: product.name as string });
    if (!itemResult.ok) {
      await logSync(organizationId, saleId, provider, 'failed', null, itemResult.error);
      return;
    }

    const lineInput = {
      itemId: itemResult.itemId,
      description: product.name as string,
      quantity: sale.quantity as number,
      unitPriceMajor: (sale.unitPrice as number) / 100,
      totalAmountMajor: (sale.totalAmount as number) / 100,
    };

    const saleGroupId = typeof sale.saleGroupId === 'string' && sale.saleGroupId ? sale.saleGroupId : null;
    const groupReceiptId = saleGroupId ? await findGroupReceiptId(organizationId, saleGroupId, saleId, provider) : null;

    const receiptResult = groupReceiptId
      ? await addLineToSalesReceipt(connection.realmId, connection.accessToken, groupReceiptId, lineInput)
      : await createSalesReceipt(connection.realmId, connection.accessToken, lineInput);

    if (!receiptResult.ok) {
      await logSync(organizationId, saleId, provider, 'failed', null, receiptResult.error);
      return;
    }

    await logSync(organizationId, saleId, provider, 'synced', receiptResult.salesReceiptId, null);
  } catch (err) {
    logger.warn('[quickbooks] sale sync failed', { error: err instanceof Error ? err.message : String(err), saleId });
  }
}

/** The SalesReceipt already created for another line of the same checkout, if any. */
async function findGroupReceiptId(organizationId: string, saleGroupId: string, saleId: string, provider: string): Promise<string | null> {
  const { data: siblings } = await supabaseAdmin
    .from('SalesEntry')
    .select('id')
    .eq('organizationId', organizationId)
    .eq('saleGroupId', saleGroupId);
  const siblingIds = ((siblings ?? []) as Array<{ id: string }>).map((r) => r.id).filter((id) => id !== saleId);
  if (siblingIds.length === 0) return null;

  const { data: logs } = await supabaseAdmin
    .from('AccountingSyncLog')
    .select('externalId, status, salesEntryId')
    .eq('organizationId', organizationId)
    .eq('provider', provider)
    .eq('status', 'synced')
    .in('salesEntryId', siblingIds);
  const hit = ((logs ?? []) as Array<{ externalId: string | null }>).find((l) => l.externalId);
  return hit?.externalId ?? null;
}

async function logSync(
  organizationId: string,
  salesEntryId: string,
  provider: string,
  status: 'synced' | 'failed' | 'skipped',
  externalId: string | null,
  errorMessage: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.from('AccountingSyncLog').insert([{
    organizationId,
    salesEntryId,
    provider,
    status,
    externalId,
    errorMessage,
    createdAt: new Date().toISOString(),
  }]);
  if (error) logger.warn('[quickbooks] failed to record sync log', { error: error.message, salesEntryId });
}
