import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import logger from '../logger';
import { hasFeature } from '../entitlements/entitlement-service.server';
import { FeatureCode } from '../entitlements/feature-codes';
import { getValidAccessToken } from '../integrations/quickbooks-connection.server';
import { createSalesReceipt, findOrCreateItem } from './quickbooks.server';

/**
 * Fire-and-forget, called from the sale-creation routes — a sale must never
 * fail because QuickBooks sync had a problem. v1 scope: one SalesReceipt per
 * sale, no chart-of-accounts mapping, no historical backfill. Every attempt
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

    const receiptResult = await createSalesReceipt(connection.realmId, connection.accessToken, {
      itemId: itemResult.itemId,
      description: product.name as string,
      quantity: sale.quantity as number,
      unitPriceMajor: (sale.unitPrice as number) / 100,
      totalAmountMajor: (sale.totalAmount as number) / 100,
    });

    if (!receiptResult.ok) {
      await logSync(organizationId, saleId, provider, 'failed', null, receiptResult.error);
      return;
    }

    await logSync(organizationId, saleId, provider, 'synced', receiptResult.salesReceiptId, null);
  } catch (err) {
    logger.warn('[quickbooks] sale sync failed', { error: err instanceof Error ? err.message : String(err), saleId });
  }
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
