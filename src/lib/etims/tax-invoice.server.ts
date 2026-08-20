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

    const invoiceNumber = await nextInvoiceNumber(organizationId);
    const now = new Date().toISOString();

    // Representative KRA-documented QR content shape: PIN, invoice number, date, total, tax.
    // Not a live verification URL — there is no KRA submission to point to.
    const qrPayload = JSON.stringify({
      pin: kraPin,
      invoiceNumber,
      date: now,
      totalAmount: totalAmount / 100,
      taxAmount: taxAmount / 100,
    });
    const qrCodeData = await buildQrCodeDataUrl(qrPayload);

    const { error } = await supabaseAdmin.from('TaxInvoice').insert([{
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
    }]);

    if (error) {
      logger.warn('[etims] failed to persist tax invoice', { error: error.message, saleId });
    }
  } catch (err) {
    logger.warn('[etims] tax invoice generation failed', { error: err instanceof Error ? err.message : String(err), saleId });
  }
}

export async function getTaxInvoiceForSale(saleId: string): Promise<TaxInvoice | null> {
  const { data } = await supabaseAdmin.from('TaxInvoice').select('*').eq('salesEntryId', saleId).maybeSingle();
  return (data as TaxInvoice | null) ?? null;
}
