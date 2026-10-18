import 'server-only';
import { supabaseAdmin } from '../supabase-client';
import logger from '../logger';
import type { TaxInvoice, TaxInvoiceLineItem } from '../types';
import { hasFeature } from '../entitlements/entitlement-service.server';
import { FeatureCode } from '../entitlements/feature-codes';

/**
 * Generates a KRA-format tax invoice for a sale — this is NOT a live
 * OSCU/VSCU submission to KRA. No such integration exists in this app; that
 * would require the tenant's own KRA eTIMS device/software certification,
 * which this session has no way to obtain or verify. This only produces a
 * KRA-shaped invoice record + QR code for the tenant's own records/printing.
 * Never present this as "submitted" or "KRA-approved" anywhere in the UI.
 *
 * Fire-and-forget by design — called from the sale-creation routes without
 * blocking the sale on success. A sale must never fail because invoice
 * generation had a problem.
 */

const VAT_STANDARD_RATE = 0.16; // Kenya's standard VAT rate

function computeLineTax(totalAmountCents: number, taxType: 'A' | 'B' | 'C' | 'D'): { taxableAmount: number; taxAmount: number } {
  if (taxType !== 'B') {
    // Exempt (A) / zero-rated (C) / non-VAT (D): no tax portion, per KRA's own definition of these codes.
    return { taxableAmount: totalAmountCents, taxAmount: 0 };
  }
  // Prices in this app are VAT-inclusive (standard Kenyan retail display convention) — back out the tax portion.
  const taxAmount = Math.round(totalAmountCents - totalAmountCents / (1 + VAT_STANDARD_RATE));
  return { taxableAmount: totalAmountCents - taxAmount, taxAmount };
}

async function nextInvoiceNumber(organizationId: string): Promise<string> {
  // Simple count-based sequence — acceptable for this pass since these are
  // informational invoices, not live KRA submissions with legal sequencing
  // requirements. A production-grade live integration would need a DB
  // sequence or advisory lock to fully rule out a race under concurrent sales.
  const { count } = await supabaseAdmin
    .from('TaxInvoice')
    .select('*', { count: 'exact', head: true })
    .eq('organizationId', organizationId);
  const next = (count ?? 0) + 1;
  return `TSIN-${String(next).padStart(6, '0')}`;
}

async function buildQrCodeDataUrl(payload: string): Promise<string> {
  const qrcodeMod = (await import('qrcode')) as unknown as { toDataURL: (s: string) => Promise<string> };
  try {
    return await qrcodeMod.toDataURL(payload);
  } catch {
    return payload;
  }
}

type TaxInvoiceRow = TaxInvoice & { saleGroupId?: string | null; salesEntryIds?: string[] | null };

/** The QR payload for an invoice: PIN, invoice number, date, total, tax (major units). */
function qrPayloadFor(row: { kraPin: string; invoiceNumber: string; createdAt: string; totalAmount: number; totalTaxAmount: number }): string {
  // Representative KRA-documented QR content shape. Not a live verification URL —
  // there is no KRA submission to point to.
  return JSON.stringify({
    pin: row.kraPin,
    invoiceNumber: row.invoiceNumber,
    date: row.createdAt,
    totalAmount: row.totalAmount / 100,
    taxAmount: row.totalTaxAmount / 100,
  });
}

/**
 * Generates the invoice for one SalesEntry. A line that belongs to a multi-item
 * checkout (saleGroupId) shares one invoice with the rest of that checkout: the
 * first line to arrive creates it and later lines are appended. Single-line
 * sales are unchanged.
 */
export async function generateTaxInvoiceForSale(saleId: string): Promise<void> {
  try {
    const { data: sale } = await supabaseAdmin.from('SalesEntry').select('*').eq('id', saleId).maybeSingle();
    if (!sale) return;

    const organizationId = sale.organizationId as string;
    if (!organizationId) return;

    const enabled = await hasFeature(organizationId, FeatureCode.ETIMS_INTEGRATION);
    if (!enabled) return;

    const { data: organization } = await supabaseAdmin.from('Organization').select('kraPin').eq('id', organizationId).maybeSingle();
    const kraPin = organization?.kraPin as string | undefined;
    if (!kraPin) return; // Not configured yet — silently skip, don't error the sale.

    const { data: existing } = await supabaseAdmin.from('TaxInvoice').select('id').eq('salesEntryId', saleId).maybeSingle();
    if (existing) return; // Already generated (e.g. a retry).

    const { data: product } = await supabaseAdmin.from('Product').select('name, taxType').eq('id', sale.productId).maybeSingle();
    const taxType = (product?.taxType as 'A' | 'B' | 'C' | 'D' | undefined) ?? 'B';
    const totalAmount = sale.totalAmount as number;
    const { taxableAmount, taxAmount } = computeLineTax(totalAmount, taxType);

    const lineItem: TaxInvoiceLineItem = {
      description: (product?.name as string) ?? 'Item',
      quantity: sale.quantity as number,
      unitPrice: sale.unitPrice as number,
      taxType,
      taxAmount,
      totalAmount,
    };

    const saleGroupId = typeof sale.saleGroupId === 'string' && sale.saleGroupId ? sale.saleGroupId : null;

    // Part of a checkout whose invoice already exists: append this line to it.
    if (saleGroupId) {
      const appended = await appendToGroupInvoice(organizationId, saleGroupId, saleId, lineItem, taxableAmount, taxAmount, totalAmount);
      if (appended !== 'no-invoice') return;
    }

    const invoiceNumber = await nextInvoiceNumber(organizationId);
    const now = new Date().toISOString();
    const qrCodeData = await buildQrCodeDataUrl(qrPayloadFor({ kraPin, invoiceNumber, createdAt: now, totalAmount, totalTaxAmount: taxAmount }));

    const baseRow = {
      organizationId,
      salesEntryId: saleId,
      invoiceNumber,
      kraPin,
      itemsJson: [lineItem],
      totalTaxableAmount: taxableAmount,
      totalTaxAmount: taxAmount,
      totalAmount,
      qrCodeData,
      status: 'generated',
      createdAt: now,
    };

    if (saleGroupId) {
      const { error } = await supabaseAdmin
        .from('TaxInvoice')
        .insert([{ ...baseRow, saleGroupId, salesEntryIds: [saleId] }]);
      if (!error) return;

      // 23505: another line of this checkout created the invoice a moment ago — join it.
      if ((error as { code?: string }).code === '23505') {
        const appended = await appendToGroupInvoice(organizationId, saleGroupId, saleId, lineItem, taxableAmount, taxAmount, totalAmount);
        if (appended !== 'no-invoice') return;
      }
      // Anything else (e.g. the per-checkout migration hasn't been run yet): fall back to
      // a standalone invoice for this line, exactly as before, rather than none at all.
      logger.warn('[etims] grouped invoice insert failed; falling back to a per-line invoice', { error: error.message, saleId });
    }

    const { error } = await supabaseAdmin.from('TaxInvoice').insert([baseRow]);
    if (error) {
      logger.warn('[etims] failed to persist tax invoice', { error: error.message, saleId });
    }
  } catch (err) {
    logger.warn('[etims] tax invoice generation failed', { error: err instanceof Error ? err.message : String(err), saleId });
  }
}

/**
 * Appends a line to its checkout's invoice. 'no-invoice' means the checkout has no
 * invoice yet (or the per-checkout columns don't exist), so the caller creates one.
 */
async function appendToGroupInvoice(
  organizationId: string,
  saleGroupId: string,
  saleId: string,
  lineItem: TaxInvoiceLineItem,
  taxableAmount: number,
  taxAmount: number,
  totalAmount: number,
): Promise<'appended' | 'already-on-invoice' | 'no-invoice'> {
  const { data: invoice, error: findError } = await supabaseAdmin
    .from('TaxInvoice')
    .select('id')
    .eq('organizationId', organizationId)
    .eq('saleGroupId', saleGroupId)
    .maybeSingle();
  if (findError || !invoice) return 'no-invoice';

  const { data: appended, error } = await supabaseAdmin.rpc('append_tax_invoice_line', {
    p_invoice_id: (invoice as { id: string }).id,
    p_sales_entry_id: saleId,
    p_item: lineItem,
    p_taxable: taxableAmount,
    p_tax: taxAmount,
    p_total: totalAmount,
  });
  if (error) {
    logger.warn('[etims] failed to append line to checkout invoice', { error: error.message, saleId, saleGroupId });
    return 'already-on-invoice'; // don't create a duplicate invoice for a line we couldn't append
  }
  return appended ? 'appended' : 'already-on-invoice';
}

/**
 * The invoice a sale appears on. For a line of a multi-item checkout that is the
 * checkout's shared invoice; its QR code is rebuilt from the current totals so it
 * always matches every line on it.
 */
export async function getTaxInvoiceForSale(saleId: string): Promise<TaxInvoice | null> {
  const { data: direct } = await supabaseAdmin.from('TaxInvoice').select('*').eq('salesEntryId', saleId).maybeSingle();
  let row = (direct as TaxInvoiceRow | null) ?? null;

  if (!row) {
    const { data: sale } = await supabaseAdmin.from('SalesEntry').select('organizationId, saleGroupId').eq('id', saleId).maybeSingle();
    const saleGroupId = (sale as { saleGroupId?: string | null } | null)?.saleGroupId;
    if (sale && saleGroupId) {
      const { data: grouped, error } = await supabaseAdmin
        .from('TaxInvoice')
        .select('*')
        .eq('organizationId', (sale as { organizationId: string }).organizationId)
        .eq('saleGroupId', saleGroupId)
        .maybeSingle();
      if (!error) row = (grouped as TaxInvoiceRow | null) ?? null;
    }
  }
  if (!row) return null;

  if (row.saleGroupId && (row.itemsJson?.length ?? 0) > 1) {
    row = { ...row, qrCodeData: await buildQrCodeDataUrl(qrPayloadFor(row)) };
  }
  return row;
}
